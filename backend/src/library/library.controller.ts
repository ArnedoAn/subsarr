import { Controller, Get, Param, Post, Query, Logger } from '@nestjs/common';
import { LibraryService } from './library.service';
import { RulesService } from '../rules/rules.service';
import { LibraryQueryDto } from './dto/library-query.dto';

@Controller('library')
export class LibraryController {
  private readonly logger = new Logger(LibraryController.name);

  constructor(
    private readonly libraryService: LibraryService,
    private readonly rulesService: RulesService,
  ) {}

  @Get()
  async list(@Query() query: LibraryQueryDto) {
    this.logger.log(
      `GET /library called with includeRules=${query.includeRules}`,
    );
    try {
      const items = await this.libraryService.getLibrary(false);
      this.logger.log(`Library returned ${items.length} items`);
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

  @Get(':id')
  async getById(@Param('id') id: string) {
    const item = await this.libraryService.getById(id);
    const rules = await this.rulesService.evaluateAll(item);
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
