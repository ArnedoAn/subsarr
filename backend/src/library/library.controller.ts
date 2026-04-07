import { Body, Controller, Get, Param, Post, Query, Logger } from '@nestjs/common';
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
  private readonly logger = new Logger(LibraryController.name);

  constructor(
    private readonly libraryService: LibraryService,
    private readonly rulesService: RulesService,
    private readonly outputService: OutputService,
    private readonly extractionService: ExtractionService,
  ) {}

  @Get()
  async list(@Query() query: LibraryQueryDto) {
    this.logger.log(
      `GET /library called with includeRules=${query.includeRules}`,
    );
    try {
      let items = await this.libraryService.getLibrary(false);
      this.logger.log(`Library returned ${items.length} items`);

      const q = query.q?.trim().toLowerCase();
      if (q) {
        items = items.filter(
          (it) =>
            it.path.toLowerCase().includes(q) ||
            it.name.toLowerCase().includes(q),
        );
      }

      const ord = query.order === 'asc' ? 1 : -1;
      if (query.sort === 'name') {
        items = [...items].sort((a, b) => ord * a.name.localeCompare(b.name));
      } else if (query.sort === 'size') {
        items = [...items].sort((a, b) => ord * (a.size - b.size));
      } else if (query.sort === 'date') {
        items = [...items].sort(
          (a, b) =>
            ord *
            (new Date(a.lastModified).getTime() -
              new Date(b.lastModified).getTime()),
        );
      } else if (query.sort === 'tracks') {
        items = [...items].sort(
          (a, b) =>
            ord *
            (a.subtitleTracks.length +
              a.externalSubtitles.length -
              (b.subtitleTracks.length + b.externalSubtitles.length)),
        );
      }

      const includeRules = query.includeRules === 'true';

      if (!includeRules) {
        return items;
      }

      return this.attachRuleStatus(items);
    } catch (err) {
      this.logger.error(`Failed to get library: ${err}`);
      throw err;
    }
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
  async rescan() {
    this.logger.log('POST /library/rescan called - forcing full rescan');
    try {
      const items = await this.libraryService.rescan();
      this.logger.log(`Rescan completed. Found ${items.length} items`);
      return this.attachRuleStatus(items);
    } catch (err) {
      this.logger.error(`Rescan failed: ${err}`);
      throw err;
    }
  }

  private async attachRuleStatus(
    items: readonly import('./media-item.entity').MediaItem[],
  ) {
    const definitions = await this.rulesService.getDefinitions();
    const config = await this.rulesService.getTranslationConfig();

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
