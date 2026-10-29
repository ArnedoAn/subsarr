import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { WorkspaceService } from './workspace.service';
import { WorkspacePersistenceService } from './workspace-persistence.service';
import {
  MemoryApproveDto,
  WorkspaceApproveDto,
  WorkspaceContextDto,
  WorkspaceCreateDto,
  WorkspaceEditDto,
  WorkspaceLibraryDto,
  WorkspacePageDto,
  WorkspaceRetranslateDto,
  WorkspaceSaveDto,
} from './workspace.dto';

@Controller('subtitle-workspace')
export class WorkspaceController {
  constructor(private readonly workspace: WorkspaceService) {}

  @Post()
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'source', maxCount: 1 },
        { name: 'translated', maxCount: 1 },
      ],
      {
        limits: {
          fileSize: 8 * 1024 * 1024,
          files: 2,
          fields: 6,
          fieldSize: 48000,
          parts: 8,
        },
      },
    ),
  )
  create(
    @UploadedFiles()
    files: {
      source?: Array<{ buffer: Buffer; originalname: string }>;
      translated?: Array<{ buffer: Buffer; originalname: string }>;
    },
    @Body() dto: WorkspaceCreateDto,
  ) {
    const source = files?.source?.[0];
    if (!source) throw new BadRequestException('Source subtitle is required');
    return this.workspace.create({
      source: source.buffer,
      translated: files.translated?.[0]?.buffer,
      filename: source.originalname,
      sourceLang: dto.sourceLanguage,
      targetLang: dto.targetLanguage,
      provider: dto.provider,
      model: dto.model,
      contextHint: dto.contextHint,
    });
  }
  @Post('library/:mediaId')
  library(@Param('mediaId') mediaId: string, @Body() dto: WorkspaceLibraryDto) {
    return this.workspace.openLibrary(mediaId, dto);
  }
  @Get(':id')
  get(@Param('id') id: string, @Query() query: WorkspacePageDto) {
    return this.workspace.get(id, query.offset, query.limit);
  }
  @Patch(':id/cues')
  edit(@Param('id') id: string, @Body() dto: WorkspaceEditDto) {
    return this.workspace.edit(id, dto);
  }
  @Post(':id/context')
  context(@Param('id') id: string, @Body() dto: WorkspaceContextDto) {
    return this.workspace.updateContext(id, dto);
  }
  @Post(':id/retranslate')
  retranslate(@Param('id') id: string, @Body() dto: WorkspaceRetranslateDto) {
    const operation = this.workspace.retranslate(id, dto);
    return { operationId: operation.id };
  }
  @Get(':id/operations/:operationId')
  operation(
    @Param('id') id: string,
    @Param('operationId') operationId: string,
  ) {
    return this.workspace.getOperation(id, operationId);
  }
  @Delete(':id/operations/:operationId')
  cancel(@Param('id') id: string, @Param('operationId') operationId: string) {
    return this.workspace.cancelOperation(id, operationId);
  }
  @Post(':id/approve-memory')
  approve(@Param('id') id: string, @Body() dto: WorkspaceApproveDto) {
    return this.workspace.approveMemory(id, dto);
  }
  @Get(':id/download')
  download(@Param('id') id: string, @Res() response: Response) {
    const file = this.workspace.download(id);
    response.setHeader('Content-Type', 'application/octet-stream');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    );
    response.send(file.content);
  }
  @Post(':id/save-library')
  save(@Param('id') id: string, @Body() dto: WorkspaceSaveDto) {
    return this.workspace.saveLibrary(id, dto);
  }
  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.workspace.delete(id);
  }
}

@Controller('translation-checkpoints')
export class WorkspaceCheckpointController {
  constructor(private readonly persistence: WorkspacePersistenceService) {}
  @Get() list(@Query() query: WorkspacePageDto) {
    return this.persistence.listCheckpoints(query.offset, query.limit);
  }
  @Delete(':id') delete(@Param('id') id: string) {
    return this.persistence.deleteCheckpoint(id);
  }
}
@Controller('translation-memory')
export class WorkspaceMemoryController {
  constructor(private readonly persistence: WorkspacePersistenceService) {}
  @Get() list(@Query() query: WorkspacePageDto) {
    return this.persistence.listMemory(query.offset, query.limit);
  }
  @Post() approve(@Body() dto: MemoryApproveDto) {
    return this.persistence.approve(dto);
  }
  @Delete(':id') delete(@Param('id') id: string) {
    return this.persistence.deleteMemory(id);
  }
}
