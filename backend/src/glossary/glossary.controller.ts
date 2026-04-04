import { Body, Controller, Get, Put } from '@nestjs/common';
import { IsArray, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { GlossaryService } from './glossary.service';

class EntryDto {
  @IsString()
  source!: string;

  @IsString()
  target!: string;
}

class PutGlossaryDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EntryDto)
  entries!: EntryDto[];
}

@Controller('glossary')
export class GlossaryController {
  constructor(private readonly glossaryService: GlossaryService) {}

  @Get()
  async get() {
    return { entries: await this.glossaryService.list() };
  }

  @Put()
  async put(@Body() body: PutGlossaryDto) {
    await this.glossaryService.save(body.entries);
    return { entries: await this.glossaryService.list() };
  }
}
