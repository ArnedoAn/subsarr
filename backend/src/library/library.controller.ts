import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { LibraryService } from './library.service';
import { RulesService } from '../rules/rules.service';
import { LibraryQueryDto } from './dto/library-query.dto';

@Controller('library')
export class LibraryController {
  constructor(
    private readonly libraryService: LibraryService,
    private readonly rulesService: RulesService,
  ) {}

  @Get()
  async list(@Query() query: LibraryQueryDto) {
    const items = await this.libraryService.getLibrary(false);
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
    return this.libraryService.rescan();
  }
}
