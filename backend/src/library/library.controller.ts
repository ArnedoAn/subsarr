import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { promises as fs } from 'node:fs';
import { LibraryService } from './library.service';
import { RulesService } from '../rules/rules.service';
import { LibraryQueryDto } from './dto/library-query.dto';
import { OutputService } from '../output/output.service';
import { ExtractionService } from '../extraction/extraction.service';
import { PreviewSubtitleDto } from './dto/preview-subtitle.dto';
import { canonicalizeLanguage } from '../common/language.utils';

class LibraryItemQueryDto {
  @IsOptional()
  @IsString()
  sourceLanguage?: string;

  @IsOptional()
  @IsString()
  targetLanguage?: string;

  @IsOptional()
  @IsString()
  targetConflictResolution?: string;
}

@Controller('library')
export class LibraryController {
  constructor(
    private readonly libraryService: LibraryService,
    private readonly rulesService: RulesService,
    private readonly outputService: OutputService,
    private readonly extractionService: ExtractionService,
  ) {}

  @Get()
  @Header('Cache-Control', 'private, max-age=30')
  async list(@Query() query: LibraryQueryDto) {
    const needsRuleFilter =
      query.status === 'eligible' || query.status === 'skipped';
    const page = await this.libraryService.queryInventory(
      query,
      needsRuleFilter,
    );
    if (needsRuleFilter) {
      const evaluated = await this.attachRuleStatus(
        page.items,
        query.targetLanguage,
      );
      const matching = evaluated.filter((item) =>
        query.status === 'skipped'
          ? item.probeStatus !== 'failed' &&
            (item.probeStatus === 'skipped' || item.ruleStatus.skip)
          : item.probeStatus === 'ok' && !item.ruleStatus.skip,
      );
      return {
        ...page,
        total: matching.length,
        items: matching.slice(page.offset, page.offset + page.limit),
      };
    }
    return {
      ...page,
      items:
        query.includeRules === 'true'
          ? await this.attachRuleStatus(page.items, query.targetLanguage)
          : page.items,
    };
  }

  @Get('groups')
  async groups(@Query() query: LibraryQueryDto) {
    const result = await this.libraryService.getGroups(query);
    if (query.status !== 'eligible' && query.status !== 'skipped')
      return result;
    const page = await this.libraryService.queryInventory(query, true);
    const evaluated = await this.attachRuleStatus(
      page.items,
      query.targetLanguage,
    );
    const counts = new Map<
      string,
      { count: number; seasons: Set<number>; targetPresent: number }
    >();
    for (const item of evaluated) {
      const matches =
        query.status === 'skipped'
          ? item.probeStatus !== 'failed' &&
            (item.probeStatus === 'skipped' || item.ruleStatus.skip)
          : item.probeStatus === 'ok' && !item.ruleStatus.skip;
      if (!matches || !item.groupKey) continue;
      const group = counts.get(item.groupKey) ?? {
        count: 0,
        seasons: new Set<number>(),
        targetPresent: 0,
      };
      group.count++;
      if (
        [...item.subtitleTracks, ...item.externalSubtitles].some(
          (track) =>
            canonicalizeLanguage(track.language) === result.targetLanguage,
        )
      ) {
        group.targetPresent++;
      }
      if (item.season !== undefined) group.seasons.add(item.season);
      counts.set(item.groupKey, group);
    }
    return {
      ...result,
      groups: result.groups
        .filter((group) => counts.has(group.key))
        .map((group) => {
          const filtered = counts.get(group.key)!;
          return {
            ...group,
            count: filtered.count,
            targetPresent: filtered.targetPresent,
            missingTarget: filtered.count - filtered.targetPresent,
            seasons: [...filtered.seasons].sort((a, b) => a - b),
          };
        }),
    };
  }

  @Get('ids')
  async ids(@Query() query: LibraryQueryDto) {
    const page = await this.libraryService.queryInventory(query, true);
    if (query.status === 'eligible' || query.status === 'skipped') {
      const evaluated = await this.attachRuleStatus(
        page.items,
        query.targetLanguage,
      );
      return {
        ids: evaluated
          .filter((item) =>
            query.status === 'skipped'
              ? item.probeStatus !== 'failed' &&
                (item.probeStatus === 'skipped' || item.ruleStatus.skip)
              : item.probeStatus === 'ok' && !item.ruleStatus.skip,
          )
          .map((item) => item.id),
      };
    }
    return { ids: page.items.map((item) => item.id) };
  }

  @Post(':id/preview-subtitle')
  async previewSubtitle(
    @Param('id') id: string,
    @Body() body: PreviewSubtitleDto,
  ) {
    const item = await this.libraryService.getById(id);
    const extraction = await this.extractionService.extractSubtitleTrack(
      item.path,
      body.sourceTrackIndex,
      'srt',
      { preview: true },
    );
    try {
      const raw = await fs.readFile(extraction.tempFilePath, 'utf8');
      const lines = raw.split(/\r?\n/);
      const previewLines = lines.slice(0, 50);
      return {
        totalLines: lines.length,
        preview: previewLines.join('\n'),
        encoding: 'utf-8',
      };
    } finally {
      await fs.unlink(extraction.tempFilePath).catch(() => undefined);
    }
  }

  @Get(':id/translation-history')
  async translationHistory(@Param('id') id: string) {
    await this.libraryService.getById(id);
    const files = await this.outputService.listTranslationHistory(id);
    return { versions: files };
  }

  @Get('scan-status')
  getScanStatus() {
    return this.libraryService.getScanStatus();
  }

  @Get(':id')
  async getById(@Param('id') id: string, @Query() query: LibraryItemQueryDto) {
    const item = await this.libraryService.getById(id);
    const override: Record<string, string> = {};
    if (query.sourceLanguage) {
      override.sourceLanguage = canonicalizeLanguage(query.sourceLanguage);
    }
    if (query.targetLanguage) {
      override.targetLanguage = canonicalizeLanguage(query.targetLanguage);
    }
    if (query.targetConflictResolution) {
      override.targetConflictResolution = query.targetConflictResolution;
    }
    const rules = await this.rulesService.evaluateAll(
      item,
      Object.keys(override).length ? override : undefined,
    );
    return {
      ...item,
      rules,
    };
  }

  @Post('rescan')
  rescan() {
    const result = this.libraryService.requestRescan();
    return {
      accepted: result.accepted,
      state: result.state,
      scan: this.libraryService.getScanStatus(),
    };
  }

  private async attachRuleStatus(
    items: readonly import('./media-item.entity').MediaItem[],
    targetLanguage?: string,
  ) {
    const definitions = await this.rulesService.getDefinitions();
    const config = await this.rulesService.getTranslationConfig(
      targetLanguage
        ? { targetLanguage: canonicalizeLanguage(targetLanguage) }
        : undefined,
    );

    return items.map((item) => ({
      ...item,
      ruleStatus: this.rulesService.evaluateWithConfig(
        item,
        definitions,
        config,
      ),
    }));
  }
}
