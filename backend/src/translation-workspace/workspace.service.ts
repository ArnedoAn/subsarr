import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { TranslationProvider } from '../contracts/providers';
import type { SubsyncEnvConfig } from '../config/subsync.config';
import {
  assertWithinMediaRoots,
  validateLanguageCode,
} from '../common/path-safety';
import { resolveProviderModel } from '../common/translation-provider';
import { ExtractionService } from '../extraction/extraction.service';
import { GlossaryService } from '../glossary/glossary.service';
import { LibraryService } from '../library/library.service';
import { OutputService } from '../output/output.service';
import { SettingsService } from '../settings/settings.service';
import { TokenUsageService } from '../settings/token-usage.service';
import { TranslationService } from '../translation/translation.service';
import {
  buildDocument,
  decodeSubtitle,
  parseDocument,
  SUPPORTED_SUBTITLE_FORMATS,
  type DocumentExtension,
  type SubtitleDocument,
} from '../translation/subtitle-document';
import { looksLikeAssSubtitle } from '../translation/subtitle-sniff';
import {
  cueContextHash,
  evaluateSubtitleQuality,
  memorySignature,
  validateCueText,
} from './quality-report';
import { WorkspacePersistenceService } from './workspace-persistence.service';
import type {
  ReviewApproveRequest,
  ReviewContextRequest,
  ReviewEditRequest,
  ReviewLibraryRequest,
  ReviewOperation,
  ReviewRetranslateRequest,
  ReviewSaveRequest,
  ReviewWorkspace,
  ReviewWorkspacePage,
} from './review.types';

const MAX_SESSIONS = 20;
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const IDLE_TTL = 60 * 60 * 1000;
interface OperationState {
  view: ReviewOperation;
  abort: AbortController;
}
interface Session {
  id: string;
  revision: number;
  filename: string;
  document: SubtitleDocument;
  texts: string[];
  sourceLanguage: string;
  targetLanguage: string;
  provider?: TranslationProvider;
  model?: string;
  contextSheet: string;
  touchedAt: number;
  bytes: number;
  libraryMediaId?: string;
  forced: boolean;
  busy: boolean;
  operations: Map<string, OperationState>;
}
export interface WorkspaceCreateInput {
  source: Buffer;
  translated?: Buffer;
  filename: string;
  sourceLang: string;
  targetLang: string;
  provider?: TranslationProvider;
  model?: string;
  contextHint?: string;
}

@Injectable()
export class WorkspaceService implements OnModuleDestroy {
  private readonly sessions = new Map<string, Session>();
  private readonly cleanup = setInterval(() => this.prune(), 60_000).unref();

  constructor(
    private readonly translation: TranslationService,
    private readonly settings: SettingsService,
    private readonly glossary: GlossaryService,
    private readonly library: LibraryService,
    private readonly output: OutputService,
    private readonly config: ConfigService,
    private readonly persistence: WorkspacePersistenceService,
    private readonly usage: TokenUsageService,
    private readonly extraction: ExtractionService,
  ) {}

  onModuleDestroy(): void {
    clearInterval(this.cleanup);
    for (const session of this.sessions.values()) this.dispose(session);
    this.sessions.clear();
  }

  create(
    input: WorkspaceCreateInput,
  ): Promise<{ id: string; revision: number }> {
    // Synchronous work, but callers rely on validation failures surfacing as rejections.
    try {
      this.prune();
      if (this.sessions.size >= MAX_SESSIONS)
        throw new ConflictException('Workspace limit reached (20 sessions)');
      if (
        !input.filename ||
        input.filename.length > 255 ||
        /[\\/\0\r\n]/.test(input.filename)
      )
        throw new BadRequestException(
          'A subtitle filename without directory components is required',
        );
      const sourceLanguage =
        input.sourceLang === 'auto'
          ? 'auto'
          : validateLanguageCode(input.sourceLang);
      const targetLanguage = validateLanguageCode(input.targetLang);
      const contextSheet = this.validateContext(input.contextHint ?? '');
      const suffix = path.extname(input.filename).slice(1).toLowerCase();
      if (!SUPPORTED_SUBTITLE_FORMATS.includes(suffix as DocumentExtension))
        throw new BadRequestException(
          'Supported subtitle formats: SRT, ASS, SSA, VTT',
        );
      const document = this.parse(input.source, suffix as DocumentExtension);
      const texts = input.translated
        ? this.translations(
            document,
            this.parse(input.translated, document.extension),
          )
        : document.cues.map((cue) => cue.text);
      const session: Session = {
        id: randomUUID(),
        revision: 1,
        filename: input.filename,
        document,
        texts,
        sourceLanguage,
        targetLanguage,
        provider: input.provider,
        model: input.model,
        contextSheet,
        touchedAt: Date.now(),
        bytes: 0,
        forced: false,
        busy: false,
        operations: new Map(),
      };
      this.reserve(session, texts, contextSheet);
      this.sessions.set(session.id, session);
      return Promise.resolve({ id: session.id, revision: session.revision });
    } catch (error) {
      return Promise.reject(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  get(id: string, offset = 0, limit = 100): ReviewWorkspacePage {
    const session = this.session(id);
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 500
    )
      throw new BadRequestException(
        'Use offset >= 0 and limit between 1 and 500',
      );
    const report = evaluateSubtitleQuality(session.document, session.texts);
    return {
      ...this.view(session),
      offset,
      limit,
      cues: report.cues.slice(offset, offset + limit),
      quality: {
        totalCues: session.texts.length,
        warningCount: report.warningCount,
        errorCount: report.errorCount,
      },
    };
  }

  edit(id: string, request: ReviewEditRequest): ReviewWorkspace {
    const session = this.session(id);
    this.assertRevision(session, request.expectedRevision);
    if (
      !Array.isArray(request.edits) ||
      !request.edits.length ||
      request.edits.length > 10000
    )
      throw new BadRequestException('Provide 1 to 10000 cue edits');
    this.indices(
      session,
      request.edits.map((edit) => edit.cueIndex),
      10000,
    );
    const texts = [...session.texts];
    for (const edit of request.edits) texts[edit.cueIndex] = edit.text;
    this.validateTexts(session.document, texts);
    this.reserve(session, texts, session.contextSheet);
    session.texts = texts;
    session.revision++;
    return this.view(session);
  }

  updateContext(id: string, request: ReviewContextRequest): ReviewWorkspace {
    const session = this.session(id);
    this.assertRevision(session, request.expectedRevision);
    const context = this.validateContext(request.contextSheet);
    this.reserve(session, session.texts, context);
    session.contextSheet = context;
    session.revision++;
    return this.view(session);
  }

  retranslate(id: string, request: ReviewRetranslateRequest): ReviewOperation {
    const session = this.session(id);
    this.assertRevision(session, request.expectedRevision);
    const indices = this.indices(session, request.cueIndices, 100);
    if (
      [...session.operations.values()].some((op) =>
        ['queued', 'running'].includes(op.view.status),
      )
    )
      throw new ConflictException('A translation operation is already active');
    if (session.operations.size >= 20)
      session.operations.delete(session.operations.keys().next().value);
    const operation: OperationState = {
      view: {
        id: randomUUID(),
        workspaceId: id,
        status: 'queued',
        progressPercent: 0,
        revision: session.revision,
      },
      abort: new AbortController(),
    };
    session.operations.set(operation.view.id, operation);
    void this.run(session, operation, indices, { ...request });
    return { ...operation.view };
  }

  getOperation(id: string, operationId: string): ReviewOperation {
    return { ...this.operation(this.session(id), operationId).view };
  }

  cancelOperation(id: string, operationId: string): ReviewOperation {
    const operation = this.operation(this.session(id), operationId);
    if (
      operation.view.status === 'queued' ||
      operation.view.status === 'running'
    ) {
      operation.abort.abort();
      operation.view.status = 'cancelled';
    }
    return { ...operation.view };
  }

  async approveMemory(
    id: string,
    request: ReviewApproveRequest,
  ): Promise<{ approved: number }> {
    const session = this.session(id);
    this.assertRevision(session, request.expectedRevision);
    if (request.approved !== true)
      throw new BadRequestException('Explicit manual approval is required');
    const indices = this.indices(session, request.cueIndices, 100);
    if (session.sourceLanguage === 'auto')
      throw new BadRequestException(
        'Choose an explicit source language before approving memory',
      );
    session.busy = true;
    try {
      const signature = memorySignature(
        await this.glossary.formatForPrompt(),
        session.contextSheet,
      );
      const sources = session.document.cues.map((cue) => cue.text);
      for (const index of indices) {
        await this.persistence.approve({
          source: sources[index],
          target: session.texts[index],
          sourceLanguage: session.sourceLanguage,
          targetLanguage: session.targetLanguage,
          contextHash: cueContextHash(sources, index),
          signature,
          approved: true,
          model: session.model,
          provenance: 'manual-workspace-approval',
        });
      }
      return { approved: indices.length };
    } finally {
      session.busy = false;
    }
  }

  download(id: string): { filename: string; content: Buffer } {
    const session = this.session(id);
    return {
      filename: `${path.parse(session.filename).name}.${session.targetLanguage}.${session.document.extension}`,
      content: Buffer.from(
        buildDocument(session.document, session.texts),
        'utf8',
      ),
    };
  }

  async openLibrary(
    mediaId: string,
    request: ReviewLibraryRequest,
  ): Promise<{ id: string; revision: number }> {
    const item = await this.library.getById(mediaId);
    const config = this.config.getOrThrow<SubsyncEnvConfig>('subsync');
    const mediaPath = await assertWithinMediaRoots(item.path, config.mediaDirs);
    const sidecar = item.externalSubtitles.find(
      (entry) => entry.path === request.subtitlePath,
    );
    let subtitlePath: string;
    if (sidecar) {
      subtitlePath = await assertWithinMediaRoots(
        sidecar.path,
        config.mediaDirs,
      );
      if (path.dirname(subtitlePath) !== path.dirname(mediaPath))
        throw new BadRequestException(
          'Subtitle must belong to the selected media item',
        );
    } else {
      if (
        !request.subtitlePath ||
        path.basename(request.subtitlePath) !== request.subtitlePath ||
        /[\\/\0]/.test(request.subtitlePath) ||
        !(await this.output.listTranslationHistory(mediaId)).includes(
          request.subtitlePath,
        )
      )
        throw new BadRequestException(
          'Choose a listed subtitle sidecar or history filename',
        );
      const historyRoot = path.join(config.dataDir, 'history');
      subtitlePath = await assertWithinMediaRoots(
        path.join(historyRoot, mediaId, request.subtitlePath),
        [historyRoot],
      );
    }
    const target = await this.readLimited(subtitlePath);
    const extension = path
      .extname(subtitlePath)
      .slice(1)
      .toLowerCase() as DocumentExtension;
    let source = target;
    let sourceLanguage = request.sourceLanguage ?? sidecar?.language ?? 'und';
    if (request.sourceTrackIndex !== undefined) {
      const track = item.subtitleTracks.find(
        (entry) => entry.index === request.sourceTrackIndex,
      );
      if (!track)
        throw new BadRequestException(
          'Subtitle source track does not belong to this media item',
        );
      sourceLanguage = request.sourceLanguage ?? track.language;
      const extracted = await this.extraction.extractSubtitleTrack(
        mediaPath,
        track.index,
        extension,
      );
      try {
        source = await this.readLimited(extracted.tempFilePath);
      } finally {
        await fs.rm(extracted.tempFilePath, { force: true });
      }
    }
    const result = await this.create({
      source,
      translated: target,
      filename: path.basename(subtitlePath),
      sourceLang: sourceLanguage,
      targetLang: request.targetLanguage ?? sidecar?.language ?? 'und',
    });
    const session = this.session(result.id);
    session.libraryMediaId = mediaId;
    session.forced = sidecar?.forced ?? false;
    return result;
  }

  async saveLibrary(
    id: string,
    request: ReviewSaveRequest,
  ): Promise<{ outputPath: string }> {
    const session = this.session(id);
    this.assertRevision(session, request.expectedRevision);
    if (!session.libraryMediaId)
      throw new BadRequestException(
        'Only library workspaces can save to the library',
      );
    session.busy = true;
    try {
      const item = await this.library.getById(session.libraryMediaId);
      const outputPath = await this.output.writeSubtitle(
        item.path,
        session.targetLanguage,
        buildDocument(session.document, session.texts),
        session.forced,
        session.document.extension,
        'default',
        { overwrite: request.overwrite === true, itemId: item.id },
      );
      return { outputPath };
    } finally {
      session.busy = false;
    }
  }

  delete(id: string): void {
    const session = this.session(id);
    if (session.busy) throw new ConflictException('Workspace is busy');
    this.dispose(session);
    this.sessions.delete(id);
  }

  private async run(
    session: Session,
    operation: OperationState,
    indices: number[],
    request: ReviewRetranslateRequest,
  ): Promise<void> {
    const revision = session.revision;
    const context = session.contextSheet;
    try {
      operation.abort.signal.throwIfAborted();
      operation.view.status = 'running';
      const settings = await this.settings.getSettings();
      const selected = resolveProviderModel(settings, {
        provider: request.provider ?? session.provider,
        model:
          request.model ??
          (request.provider && request.provider !== session.provider
            ? undefined
            : session.model),
      });
      const glossaryHint = await this.glossary.formatForPrompt();
      const sources = session.document.cues;
      // Include only a bounded neighborhood; context is untrusted read-only data.
      const neighbors = indices.slice(0, 10).map((index) => ({
        cueIndex: index,
        before: sources[index - 1]?.text.slice(0, 160) ?? '',
        after: sources[index + 1]?.text.slice(0, 160) ?? '',
      }));
      const neighborContext = JSON.stringify(neighbors).slice(0, 4000);
      const result = await this.translation.translateLines(
        indices.map((index) => sources[index].text),
        session.targetLanguage,
        settings.openRouterApiKey,
        settings.deepSeekApiKey,
        {
          ...selected,
          sessionId: session.id,
          sourceLanguage: session.sourceLanguage,
          subtitleFormat: session.document.extension,
          glossaryHint,
          contextHint:
            context +
            `\nNeighbor context data:\n${neighborContext}`.slice(
              0,
              12000 - context.length,
            ),
          signal: operation.abort.signal,
          allowBudgetOverride: request.allowBudgetOverride,
          verificationEnabled: settings.translationVerificationEnabled,
          onUsage: (attempt) => this.usage.addProviderUsage(attempt),
          onProgress: (info) => {
            operation.view.progressPercent = info.progressPercent;
          },
        },
      );
      operation.abort.signal.throwIfAborted();
      if (
        this.sessions.get(session.id) !== session ||
        Date.now() - session.touchedAt >= IDLE_TTL
      )
        throw new ConflictException('Workspace expired or closed');
      this.assertRevision(session, revision);
      if (result.lines.length !== indices.length)
        throw new Error('Translated cue count changed');
      const texts = [...session.texts];
      indices.forEach((index, position) => {
        texts[index] = result.lines[position];
      });
      this.validateTexts(session.document, texts);
      this.reserve(session, texts, session.contextSheet);
      session.texts = texts;
      session.provider = selected.provider;
      session.model = selected.model;
      session.revision++;
      operation.view.revision = session.revision;
      operation.view.progressPercent = 100;
      operation.view.status = 'completed';
    } catch (error) {
      operation.view.status = operation.abort.signal.aborted
        ? 'cancelled'
        : 'failed';
      // Provider failures may contain request details. Do not expose secrets or subtitle text.
      operation.view.error =
        error instanceof ConflictException
          ? 'Workspace revision changed or workspace is unavailable; results were not applied'
          : 'Translation did not complete; no cues were changed';
    }
  }

  private session(id: string): Session {
    this.prune();
    const session = this.sessions.get(id);
    if (!session) throw new NotFoundException('Workspace not found or expired');
    session.touchedAt = Date.now();
    return session;
  }

  private view(session: Session): ReviewWorkspace {
    return {
      id: session.id,
      revision: session.revision,
      filename: session.filename,
      format: session.document.extension,
      sourceLanguage: session.sourceLanguage,
      targetLanguage: session.targetLanguage,
      contextSheet: session.contextSheet,
      cueCount: session.texts.length,
      libraryMediaId: session.libraryMediaId,
      expiresAt: new Date(session.touchedAt + IDLE_TTL).toISOString(),
    };
  }

  private assertRevision(session: Session, revision: number): void {
    if (!Number.isSafeInteger(revision) || revision !== session.revision)
      throw new ConflictException(
        'Workspace revision changed; reload before editing',
      );
    if (session.busy) throw new ConflictException('Workspace is busy');
  }

  private operation(session: Session, id: string): OperationState {
    const operation = session.operations.get(id);
    if (!operation)
      throw new NotFoundException('Workspace operation not found');
    return operation;
  }

  private indices(session: Session, indices: number[], max: number): number[] {
    if (
      !Array.isArray(indices) ||
      !indices.length ||
      indices.length > max ||
      new Set(indices).size !== indices.length ||
      indices.some(
        (index) =>
          !Number.isSafeInteger(index) ||
          index < 0 ||
          index >= session.texts.length,
      )
    )
      throw new BadRequestException(
        `Choose 1 to ${max} unique valid cue ordinals`,
      );
    return [...indices];
  }

  private validateContext(value: string): string {
    if (
      typeof value !== 'string' ||
      value.length > 12000 ||
      value.includes('\0')
    )
      throw new BadRequestException(
        'Context must contain at most 12000 characters and no NUL',
      );
    return value;
  }

  private parse(input: Buffer, extension: DocumentExtension): SubtitleDocument {
    if (!Buffer.isBuffer(input) || input.length > MAX_FILE_BYTES)
      throw new PayloadTooLargeException('Subtitle exceeds 8 MiB');
    try {
      const content = decodeSubtitle(input);
      const detected = looksLikeAssSubtitle(content)
        ? extension === 'ssa'
          ? 'ssa'
          : 'ass'
        : /^\ufeff?WEBVTT(?:[ \t\r\n]|$)/.test(content)
          ? 'vtt'
          : extension;
      const document = parseDocument(content, detected);
      if (!document.cues.length || document.cueCount > 10000)
        throw new Error(
          'Subtitle must contain 1 to 10000 cues with translatable text',
        );
      return document;
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid subtitle',
      );
    }
  }

  private translations(
    source: SubtitleDocument,
    target: SubtitleDocument,
  ): string[] {
    if (
      target.extension !== source.extension ||
      target.cueCount !== source.cueCount ||
      target.cues.length !== source.cues.length ||
      JSON.stringify(target.preservedCues) !==
        JSON.stringify(source.preservedCues) ||
      target.cues.some(
        (cue, index) =>
          cue.index !== source.cues[index].index ||
          cue.start !== source.cues[index].start ||
          cue.end !== source.cues[index].end,
      )
    )
      throw new BadRequestException(
        'Translated subtitle must preserve cue identities and timestamps',
      );
    const texts = target.cues.map((cue) => cue.text);
    this.validateTexts(source, texts);
    return texts;
  }

  private validateTexts(document: SubtitleDocument, texts: string[]): void {
    try {
      texts.forEach((text, index) =>
        validateCueText(document.cues[index].text, text, {
          allowLineBreakChanges: true,
        }),
      );
      const content = buildDocument(document, texts);
      if (Buffer.byteLength(content) > MAX_FILE_BYTES)
        throw new Error('Subtitle exceeds 8 MiB');
      const rebuilt = parseDocument(content, document.extension);
      if (
        rebuilt.cueCount !== document.cueCount ||
        rebuilt.cues.length !== document.cues.length ||
        JSON.stringify(rebuilt.preservedCues) !==
          JSON.stringify(document.preservedCues) ||
        rebuilt.cues.some(
          (cue, index) =>
            cue.index !== document.cues[index].index ||
            cue.start !== document.cues[index].start ||
            cue.end !== document.cues[index].end,
        )
      )
        throw new Error('Edit changed subtitle structure');
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid cue edit',
      );
    }
  }

  private reserve(session: Session, texts: string[], context: string): void {
    // Account retained UTF-16 strings plus conservative cue/operation metadata overhead.
    const bytes =
      2 *
        (session.document.content.length +
          context.length +
          session.filename.length +
          session.document.cues.reduce((sum, cue) => sum + cue.text.length, 0) +
          texts.reduce((sum, text) => sum + text.length, 0)) +
      session.document.cues.length * 512 +
      32768;
    let total = bytes;
    for (const existing of this.sessions.values())
      if (existing !== session) total += existing.bytes;
    if (total > MAX_BYTES)
      throw new PayloadTooLargeException(
        'Workspace memory limit reached (20 MiB)',
      );
    session.bytes = bytes;
  }

  private async readLimited(filename: string): Promise<Buffer> {
    const handle = await fs.open(filename, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES)
        throw new PayloadTooLargeException(
          'Subtitle must be a regular file of at most 8 MiB',
        );
      const buffer = Buffer.alloc(Math.min(stat.size + 1, MAX_FILE_BYTES + 1));
      let length = 0;
      while (length < buffer.length) {
        const result = await handle.read(
          buffer,
          length,
          buffer.length - length,
          null,
        );
        if (!result.bytesRead) break;
        length += result.bytesRead;
      }
      if (length > stat.size || length > MAX_FILE_BYTES)
        throw new BadRequestException('Subtitle changed while loading; retry');
      return buffer.subarray(0, length);
    } finally {
      await handle.close();
    }
  }

  private prune(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.touchedAt >= IDLE_TTL && !session.busy) {
        this.dispose(session);
        this.sessions.delete(id);
      }
    }
  }

  private dispose(session: Session): void {
    for (const operation of session.operations.values())
      operation.abort.abort();
  }
}
