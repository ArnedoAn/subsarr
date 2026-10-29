import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  type OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { SettingsService } from '../settings/settings.service';
import { TokenUsageService } from '../settings/token-usage.service';
import { validateProviderModel } from '../common/translation-provider';
import { SubtitleTranslationService } from '../translation/subtitle-translation.service';
import type { ProviderUsage } from '../translation/translation.service';
import {
  loadEvaluationCase,
  loadEvaluationCorpus,
  scoreEvaluation,
  type EvaluationCase,
  type EvaluationCorpus,
  type EvaluationScore,
} from './evaluation-scoring';
import { RunEvaluationDto } from './run-evaluation.dto';

export interface EvaluationReport {
  corpusVersion: string;
  limitations: string;
  score: EvaluationScore;
  humanReview: Array<{
    dimension: string;
    scale: string;
    anchors: string;
    score: null;
  }>;
  actual: {
    latencyMs: number;
    providerResponses: ProviderUsage[];
    responseCostUsd: number | null;
    costNote: string;
  };
}
interface EvaluationRun {
  id: string;
  caseId: string;
  provider: string;
  model: string;
  qualityMode: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  createdAt: string;
  completedAt?: string;
  error?: string;
  report?: EvaluationReport;
  controller: AbortController;
  responses: ProviderUsage[];
}

@Injectable()
export class EvaluationService implements OnModuleDestroy {
  private readonly runs = new Map<string, EvaluationRun>();

  constructor(
    private readonly subtitles: SubtitleTranslationService,
    private readonly settings: SettingsService,
    private readonly usage: TokenUsageService,
  ) {}

  async run(request: RunEvaluationDto) {
    let corpus: EvaluationCorpus;
    try {
      corpus = loadEvaluationCorpus();
    } catch {
      throw new ServiceUnavailableException(
        'Evaluation corpus unavailable; install backend/benchmarks/subtitles/v1 or configure SUBSYNC_EVALUATION_CORPUS_DIR',
      );
    }
    const testCase = corpus.cases.find((entry) => entry.id === request.caseId);
    if (!testCase)
      throw new BadRequestException('Unknown evaluation corpus case');
    validateProviderModel(request.provider, request.model);
    await this.settings.assertTranslationBudget({
      ...request,
      automatic: false,
    });
    // Keep completed reports bounded without evicting a live cancellation handle.
    for (const [id, run] of this.runs) {
      if (run.completedAt && Date.now() - Date.parse(run.completedAt) > 3600000)
        this.runs.delete(id);
    }
    if ([...this.runs.values()].filter((run) => !run.completedAt).length >= 2)
      throw new ConflictException(
        'At most two evaluations can run concurrently',
      );
    if (this.runs.size >= 100) {
      const oldest = [...this.runs.values()].find((run) => run.completedAt);
      if (oldest) this.runs.delete(oldest.id);
    }
    const run: EvaluationRun = {
      id: randomUUID(),
      caseId: testCase.id,
      provider: request.provider,
      model: request.model,
      qualityMode: request.qualityMode ?? 'fast',
      status: 'queued',
      createdAt: new Date().toISOString(),
      controller: new AbortController(),
      responses: [],
    };
    this.runs.set(run.id, run);
    setImmediate(() => {
      void this.execute(run, request, corpus, testCase);
    });
    return { id: run.id, status: run.status };
  }

  private async execute(
    run: EvaluationRun,
    request: RunEvaluationDto,
    corpus: EvaluationCorpus,
    testCase: EvaluationCase,
  ) {
    const started = performance.now();
    try {
      run.controller.signal.throwIfAborted();
      run.status = 'running';
      const { source, reference } = loadEvaluationCase(testCase);
      const translated = await this.subtitles.translateDocument(
        source,
        testCase.source,
        {
          ...request,
          sourceLanguage: corpus.sourceLanguage,
          targetLanguage: corpus.targetLanguage,
          automatic: false,
          persistence: 'ephemeral',
          signal: run.controller.signal,
          onUsage: async (attempt) => {
            await this.usage.addProviderUsage(attempt);
            run.responses.push({ ...attempt });
          },
        },
      );
      run.controller.signal.throwIfAborted();
      const knownCost =
        run.responses.length > 0 &&
        run.responses.every(
          (response) =>
            response.tier !== 'subscription' && response.costUsd !== undefined,
        );
      run.report = {
        corpusVersion: corpus.version,
        limitations: corpus.limitations,
        score: scoreEvaluation(testCase, source, reference, translated.content),
        humanReview: corpus.rubric.map((criterion) => ({
          ...criterion,
          score: null,
        })),
        actual: {
          latencyMs: Math.round(performance.now() - started),
          providerResponses: run.responses,
          responseCostUsd: knownCost
            ? run.responses.reduce(
                (sum, response) => sum + response.costUsd!,
                0,
              )
            : null,
          costNote:
            'Only response-reported monetary costs are summed. Subscription quota is not an additional monetary charge; unknown cost is null. Usage ledger may separately record pricing estimates.',
        },
      };
      run.status = 'completed';
    } catch (error) {
      run.status = run.controller.signal.aborted ? 'cancelled' : 'failed';
      run.error = error instanceof Error ? error.message : 'Evaluation failed';
    } finally {
      run.completedAt = new Date().toISOString();
    }
  }

  private requireRun(id: string): EvaluationRun {
    const run = this.runs.get(id);
    if (
      run?.completedAt &&
      Date.now() - Date.parse(run.completedAt) > 3600000
    ) {
      this.runs.delete(id);
      throw new NotFoundException('Evaluation report expired');
    }
    if (!run)
      throw new NotFoundException(
        'Evaluation not found (reports expire after one hour or server restart)',
      );
    return run;
  }

  get(id: string) {
    const run = this.requireRun(id);
    return {
      id: run.id,
      caseId: run.caseId,
      provider: run.provider,
      model: run.model,
      qualityMode: run.qualityMode,
      status: run.status,
      createdAt: run.createdAt,
      completedAt: run.completedAt,
      error: run.error,
      providerResponses: run.responses,
    };
  }

  report(id: string): EvaluationReport {
    const run = this.requireRun(id);
    if (!run.report)
      throw new ConflictException(
        `Evaluation report unavailable: ${run.status}`,
      );
    return run.report;
  }

  cancel(id: string) {
    const run = this.requireRun(id);
    if (!run.completedAt)
      run.controller.abort(new Error('Evaluation cancelled'));
    return this.get(id);
  }

  onModuleDestroy() {
    for (const run of this.runs.values())
      if (!run.completedAt)
        run.controller.abort(new Error('Server shutting down'));
  }
}
