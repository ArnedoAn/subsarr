import { Controller, Get, Post, Query, Body, BadRequestException } from '@nestjs/common';
import { ExecuteRenameDto } from './dto/rename.dto';
import { RenameService } from './rename.service';

@Controller('rename')
export class RenameController {
  constructor(private readonly renameService: RenameService) {}

  @Get('preview')
  async getPreview(@Query('dir') dir: string) {
    if (!dir) {
      throw new BadRequestException('Directory path is required (dir query param)');
    }
    return this.renameService.getPreview(dir);
  }

  @Post('execute')
  async executeRename(@Body() dto: ExecuteRenameDto) {
    if (!dto.operations || !Array.isArray(dto.operations)) {
      throw new BadRequestException('Invalid operations array');
    }
    return this.renameService.executeRename(dto.operations);
  }
}
