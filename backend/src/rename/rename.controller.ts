import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  CreateRenamePlanDto,
  ExecuteRenameDto,
  ReviseRenamePlanDto,
  SelectRenameMetadataDto,
} from './dto/rename.dto';
import { RenameService } from './rename.service';
import { RenameMetadataService } from './rename-metadata.service';
@Controller('rename')
export class RenameController {
  constructor(
    private readonly rename: RenameService,
    private readonly metadata: RenameMetadataService,
  ) {}
  @Post('preview')
  preview(@Body() dto: CreateRenamePlanDto) {
    return this.rename.getPreview(
      dto.directory,
      dto.templates,
      dto.seasonFolders,
    );
  }
  @Post('revise')
  revise(@Body() dto: ReviseRenamePlanDto) {
    return this.rename.revise(dto.planId, dto.edits, dto.templates);
  }
  @Post('dry-run')
  dryRun(@Body() dto: ExecuteRenameDto) {
    return this.rename.dryRun(dto.planId);
  }
  @Post('execute')
  execute(@Body() dto: ExecuteRenameDto) {
    return this.rename.executeRename(dto.planId);
  }
  @Get('history')
  history() {
    return this.rename.history();
  }
  @Post('history/:batchId/undo')
  undo(@Param('batchId') batchId: string) {
    return this.rename.undo(batchId);
  }
  @Get('metadata')
  lookup(@Query('q') query: string, @Query('kind') kind: 'movie' | 'episode') {
    return this.metadata.lookup(query, kind);
  }
  @Post('metadata/select')
  async select(@Body() dto: SelectRenameMetadataDto) {
    const match = this.metadata.select(dto.matchId);
    const plan = await this.rename.dryRun(dto.planId);
    const row = plan.rows.find(
      (entry) => entry.id === dto.rowId && !entry.sidecar,
    );
    if (!row)
      throw new BadRequestException('Choose a video row from this plan');
    const edits = dto.edits ?? [];
    const editedClassification = edits.find(
      (edit) => edit.id === row.id,
    )?.classification;
    const classification = {
      ...row.classification,
      ...editedClassification,
      kind: match.kind,
      title: match.title,
      year: match.year ?? editedClassification?.year ?? row.classification.year,
      confidence: 'manual' as const,
    };
    return this.rename.revise(dto.planId, [
      ...edits.filter((edit) => edit.id !== row.id),
      {
        ...edits.find((edit) => edit.id === row.id),
        id: row.id,
        classification,
      },
    ]);
  }
}
