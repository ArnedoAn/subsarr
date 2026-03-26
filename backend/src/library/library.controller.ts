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
    this.logger.log(`GET /library called with includeRules=${query.includeRules}`);
    try {
      const items = await this.libraryService.getLibrary(false);
      this.logger.log(`Library returned ${items.length} items`);
      const includeRules = query.includeRules === 'true';

      if (!includeRules) {
        return items;
      }

      return Promise.all(
        items.map(async (item) => ({
          ...item,
          ruleStatus: await this.rulesService.evaluate(item),
        })),
      );
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
      
      // Include rule evaluation like GET endpoint
      return Promise.all(
        items.map(async (item) => ({
          ...item,
          ruleStatus: await this.rulesService.evaluate(item),
        })),
      );
    } catch (err) {
      this.logger.error(`Rescan failed: ${err}`);
      throw err;
    }
  }
}
