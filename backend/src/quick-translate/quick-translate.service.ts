import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Subject } from 'rxjs';
import { SubtitleTranslationService } from '../translation/subtitle-translation.service';
import { SettingsService } from '../settings/settings.service';
import { TokenUsageService } from '../settings/token-usage.service';
import { validateLanguageCode } from '../common/path-safety';
import { resolveProviderModel } from '../common/translation-provider';
import { WorkspaceService } from '../translation-workspace/workspace.service';
import {
  QuickBatchSnapshot,
  QuickFileSnapshot,
  QuickTranslationOptions,
} from './quick-translate.types';
import { QUICK_LIMITS, QuickUpload } from './quick-translate.internal';
interface MemoryFile extends QuickFileSnapshot {
  input?: Buffer;
  result?: Buffer;
  controller?: AbortController;
}
interface MemoryBatch {
  id: string;
  requestId: string;
  revision: number;
  expiresAt: number | null;
  options: QuickTranslationOptions;
  files: MemoryFile[];
  changes: Subject<void>;
}

@Injectable()
export class QuickTranslateService implements OnModuleInit, OnModuleDestroy {
  private readonly batches = new Map<string, MemoryBatch>();
  private readonly requests = new Map<string, string>();
  private readonly queue: Array<{ batch: MemoryBatch; file: MemoryFile }> = [];
  private inputBytes = 0;
  private resultBytes = 0;
  private running = false;
  private stopped = false;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(
    private readonly documents: SubtitleTranslationService,
    private readonly settings: SettingsService,
    private readonly usage: TokenUsageService,
    private readonly workspaces: WorkspaceService,
  ) {}

  onModuleInit(): void {
    if (this.cleanupTimer || this.stopped) return;
    this.cleanupTimer = setInterval(() => this.expire(), 60_000);
    this.cleanupTimer.unref();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    clearInterval(this.cleanupTimer);
    for (const batch of this.batches.values()) this.dispose(batch);
    this.queue.length = 0;
  }

  async create(
    files: QuickUpload[],
    options: QuickTranslationOptions,
    requestId: string,
  ): Promise<QuickBatchSnapshot> {
    this.expire();
    if (!/^[a-zA-Z0-9_-]{16,100}$/.test(requestId))
      throw new BadRequestException('A unique requestId is required');
    const previous = this.requests.get(requestId);
    if (previous) return this.snapshot(previous);
    if (this.stopped)
      throw new ServiceUnavailableException('Quick translation is stopping');
    if (!files?.length || files.length > QUICK_LIMITS.files)
      throw new BadRequestException('Upload between 1 and 20 subtitle files');
    const bytes = files.reduce((sum, file) => sum + file.buffer.length, 0);
    if (
      files.some(
        (file) =>
          !file.buffer.length || file.buffer.length > QUICK_LIMITS.fileBytes,
      ) ||
      bytes > QUICK_LIMITS.batchBytes
    )
      throw new BadRequestException(
        'Limits: 2 MB per file and 20 MB per batch',
      );
    options = {
      ...options,
      ...resolveProviderModel(await this.settings.getSettings(), options),
      targetLanguage: validateLanguageCode(options.targetLanguage),
      sourceLanguage: options.sourceLanguage
        ? validateLanguageCode(options.sourceLanguage)
        : undefined,
    };
    const inspected = files.map((file) => {
      try {
        return this.documents.inspectDocument(file.buffer, file.originalname);
      } catch (error) {
        throw new BadRequestException(
          `${this.safeName(file.originalname)}: ${error instanceof Error ? error.message : 'Invalid subtitle content'}`,
        );
      }
    });
    await this.settings.assertTranslationBudget({
      provider: options.provider,
      automatic: false,
      allowBudgetOverride: options.allowBudgetOverride,
    });
    // The budget check yields: repeat idempotency and capacity checks atomically afterward.
    const concurrent = this.requests.get(requestId);
    if (concurrent) return this.snapshot(concurrent);
    if (this.stopped)
      throw new ServiceUnavailableException('Quick translation is stopping');
    if (
      this.batches.size >= QUICK_LIMITS.batches ||
      this.inputBytes + bytes > QUICK_LIMITS.inputBytes
    )
      throw new ServiceUnavailableException(
        'Quick translation memory is full; cancel files or wait for expiry',
      );
    const names = new Set<string>();
    const batch: MemoryBatch = {
      id: randomUUID(),
      requestId,
      revision: 1,
      expiresAt: null,
      options,
      changes: new Subject<void>(),
      files: files.map((file, index) => {
        const name = this.safeName(file.originalname);
        const extension = inspected[index].extension;
        const base = name.replace(/\.[^.]+$/, '') || 'subtitle';
        let downloadName = `${base}.${options.targetLanguage}.${extension}`;
        for (
          let duplicate = 2;
          names.has(downloadName.toLowerCase());
          duplicate++
        )
          downloadName = `${base} (${duplicate}).${options.targetLanguage}.${extension}`;
        names.add(downloadName.toLowerCase());
        return {
          id: randomUUID(),
          name,
          downloadName,
          input: file.buffer,
          state: 'queued',
          progress: 0,
          cueCount: inspected[index].cueCount,
          provider: options.provider,
          model: options.model,
          warnings: [],
        };
      }),
    };
    this.inputBytes += bytes;
    this.batches.set(batch.id, batch);
    this.requests.set(requestId, batch.id);
    for (const file of batch.files) this.queue.push({ batch, file });
    setImmediate(() => {
      void this.drain();
    });
    return this.toSnapshot(batch);
  }

  snapshot(id: string): QuickBatchSnapshot {
    return this.toSnapshot(this.get(id));
  }
  changes(id: string): Subject<void> {
    return this.get(id).changes;
  }
  requestSnapshot(requestId: string): QuickBatchSnapshot {
    const id = this.requests.get(requestId);
    if (!id)
      throw new NotFoundException(
        'Upload has not been accepted or has expired',
      );
    return this.snapshot(id);
  }

  cancel(id: string, fileId?: string): QuickBatchSnapshot {
    const batch = this.get(id);
    const files = fileId ? [this.file(batch, fileId)] : batch.files;
    for (const file of files) {
      if (file.state === 'queued' || file.state === 'translating') {
        file.state = 'cancelled';
        file.controller?.abort();
        this.releaseInput(file);
      }
    }
    this.publish(batch);
    return this.toSnapshot(batch);
  }

  async retry(
    id: string,
    allowBudgetOverride = false,
  ): Promise<QuickBatchSnapshot> {
    const batch = this.get(id);
    await this.settings.assertTranslationBudget({
      provider: batch.options.provider,
      automatic: false,
      allowBudgetOverride:
        batch.options.allowBudgetOverride || allowBudgetOverride,
    });
    if (this.get(id) !== batch) throw new NotFoundException('Batch expired');
    batch.options.allowBudgetOverride ||= allowBudgetOverride;
    for (const file of batch.files) {
      if (file.state === 'failed' && file.input) {
        file.state = 'queued';
        file.error = undefined;
        file.errorCode = undefined;
        file.progress = 0;
        this.queue.push({ batch, file });
      }
    }
    this.publish(batch);
    setImmediate(() => {
      void this.drain();
    });
    return this.toSnapshot(batch);
  }

  download(id: string, fileId: string): { name: string; content: Buffer } {
    const file = this.file(this.get(id), fileId);
    if (file.state !== 'completed' || !file.result)
      throw new ConflictException('Translation is not ready');
    return { name: file.downloadName, content: file.result };
  }

  async createWorkspace(
    id: string,
    fileId: string,
  ): Promise<{ id: string; revision: number }> {
    const batch = this.get(id);
    const file = this.file(batch, fileId);
    if (file.state !== 'completed' || !file.input || !file.result)
      throw new ConflictException('Translation is not ready for review');
    return this.workspaces.create({
      source: file.input,
      translated: file.result,
      filename: file.name,
      sourceLang: batch.options.sourceLanguage ?? 'auto',
      targetLang: batch.options.targetLanguage,
      provider: batch.options.provider,
      model: batch.options.model,
      contextHint: file.contextSheet ?? batch.options.contextHint,
    });
  }

  downloads(id: string): Array<{ name: string; content: Buffer }> {
    const batch = this.get(id);
    const ready = batch.files.filter((file) => file.state === 'completed');
    if (!ready.length)
      throw new ConflictException('No completed translations to download');
    return ready.map((file) => ({
      name: file.downloadName,
      content: file.result!,
    }));
  }

  expire(now = Date.now()): void {
    for (const batch of this.batches.values())
      if (batch.expiresAt !== null && batch.expiresAt <= now)
        this.dispose(batch);
  }

  private async drain(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      while (this.queue.length && !this.stopped) {
        const { batch, file } = this.queue.shift()!;
        if (
          !this.batches.has(batch.id) ||
          file.state !== 'queued' ||
          !file.input
        )
          continue;
        file.state = 'translating';
        file.controller = new AbortController();
        this.publish(batch);
        try {
          // One FIFO worker reserves room for the largest allowed result before any provider call.
          if (
            this.resultBytes + QUICK_LIMITS.resultFileBytes >
            QUICK_LIMITS.resultBytes
          )
            throw new Error(
              'Result memory limit reached; existing batches must expire before retry',
            );
          await this.settings.assertTranslationBudget({
            provider: batch.options.provider,
            automatic: false,
            allowBudgetOverride: batch.options.allowBudgetOverride,
          });
          file.controller.signal.throwIfAborted();
          const translated = await this.documents.translateDocument(
            file.input,
            file.name,
            {
              ...batch.options,
              sessionId: file.id,
              persistence: 'ephemeral',
              automatic: false,
              signal: file.controller.signal,
              onUsage: async (attempt) => {
                await this.usage.addProviderUsage(attempt);
              },
              onProgress: (info) => {
                if (file.state === 'translating') {
                  file.progress = Math.min(
                    99,
                    Math.max(0, info.progressPercent),
                  );
                  this.publish(batch);
                }
              },
            },
          );
          file.controller.signal.throwIfAborted();
          if (!this.batches.has(batch.id)) continue;
          const size = Buffer.byteLength(translated.content);
          if (
            size > QUICK_LIMITS.resultFileBytes ||
            this.resultBytes + size > QUICK_LIMITS.resultBytes
          )
            throw new Error(
              'Result memory limit reached; download existing results and wait for expiry',
            );
          file.result = Buffer.from(translated.content);
          this.resultBytes += size;
          file.warnings = translated.warnings
            .slice(0, 20)
            .map((warning) => warning.slice(0, 1000));
          file.qualityReport = translated.qualityReport
            ? {
                warningCount: translated.qualityReport.warningCount,
                errorCount: translated.qualityReport.errorCount,
                suspectCueIndices: translated.qualityReport.suspectCueIndices,
              }
            : undefined;
          file.checkpointReusedCues = translated.checkpointReusedCues;
          file.memoryReusedCues = translated.memoryReusedCues;
          file.contextSheet = translated.contextSheet;
          file.tierUsed = translated.tierUsed;
          file.usage = translated.usage;
          file.progress = 100;
          file.state = 'completed';
        } catch (error) {
          if (!this.batches.has(batch.id)) continue;
          if (file.controller.signal.aborted) {
            file.state = 'cancelled';
            this.releaseInput(file);
          } else {
            file.state = 'failed';
            file.error =
              error instanceof Error
                ? error.message.slice(0, 1000)
                : 'Translation failed';
            file.errorCode =
              error instanceof HttpException && error.getStatus() === 409
                ? 'BUDGET_OVERRIDE_REQUIRED'
                : undefined;
          }
        } finally {
          file.controller = undefined;
          if (this.batches.has(batch.id)) this.publish(batch);
        }
      }
    } finally {
      this.running = false;
    }
  }

  private safeName(name: string): string {
    const clean = (name.split(/[\\/]/).pop() || 'subtitle').replace(
      // eslint-disable-next-line no-control-regex -- Strip control bytes from untrusted uploaded filenames.
      /[\x00-\x1f\x7f:"<>|?*]/g,
      '_',
    );
    if (clean.length <= 180) return clean;
    const extension = clean.match(/\.[a-zA-Z0-9]{1,5}$/)?.[0] ?? '';
    return clean.slice(0, 180 - extension.length) + extension;
  }
  private releaseInput(file: MemoryFile): void {
    if (file.input) {
      this.inputBytes -= file.input.length;
      file.input = undefined;
    }
  }
  private get(id: string): MemoryBatch {
    const batch = this.batches.get(id);
    if (!batch || (batch.expiresAt !== null && batch.expiresAt <= Date.now())) {
      if (batch) this.dispose(batch);
      throw new NotFoundException('Quick translation expired or not found');
    }
    return batch;
  }
  private file(batch: MemoryBatch, id: string): MemoryFile {
    const file = batch.files.find((entry) => entry.id === id);
    if (!file) throw new NotFoundException('File not found');
    return file;
  }
  private publish(batch: MemoryBatch): void {
    const pending = batch.files.some(
      (file) =>
        file.state === 'queued' ||
        file.state === 'translating' ||
        file.controller !== undefined,
    );
    if (pending) batch.expiresAt = null;
    else batch.expiresAt ??= Date.now() + QUICK_LIMITS.ttlMs;
    batch.revision++;
    batch.changes.next();
  }
  private toSnapshot(batch: MemoryBatch): QuickBatchSnapshot {
    return {
      id: batch.id,
      revision: batch.revision,
      expiresAt:
        batch.expiresAt === null
          ? null
          : new Date(batch.expiresAt).toISOString(),
      files: batch.files.map(
        ({
          id,
          name,
          downloadName,
          state,
          progress,
          cueCount,
          error,
          errorCode,
          warnings,
          qualityReport,
          checkpointReusedCues,
          memoryReusedCues,
          contextSheet,
          provider,
          model,
          tierUsed,
          usage,
        }) => ({
          id,
          name,
          downloadName,
          state,
          progress,
          cueCount,
          error,
          errorCode,
          warnings,
          qualityReport,
          checkpointReusedCues,
          memoryReusedCues,
          contextSheet,
          provider,
          model,
          tierUsed,
          usage,
        }),
      ),
    };
  }
  private dispose(batch: MemoryBatch): void {
    for (const file of batch.files) {
      file.controller?.abort();
      this.releaseInput(file);
      if (file.result) {
        this.resultBytes -= file.result.length;
        file.result = undefined;
      }
    }
    for (let index = this.queue.length - 1; index >= 0; index--)
      if (this.queue[index].batch === batch) this.queue.splice(index, 1);
    batch.changes.complete();
    this.batches.delete(batch.id);
    this.requests.delete(batch.requestId);
  }
}
