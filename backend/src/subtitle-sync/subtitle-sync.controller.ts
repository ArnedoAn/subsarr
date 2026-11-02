import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ListSubtitleSyncDto, StartSubtitleSyncDto } from './subtitle-sync.dto';
import {
  SUBTITLE_SYNC_LIMITS,
  SubtitleSyncService,
  type SubtitleSyncUpload,
} from './subtitle-sync.service';

@Controller('subtitle-sync')
export class SubtitleSyncController {
  constructor(private readonly sync: SubtitleSyncService) {}

  @Post()
  // Without `dest`/`storage`, multer buffers the single bounded file in memory.
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: SUBTITLE_SYNC_LIMITS.inputBytes,
        files: 1,
        fields: 12,
        fieldSize: 8_192,
        parts: 16,
      },
    }),
  )
  start(
    @Body() dto: StartSubtitleSyncDto,
    @UploadedFile() file?: SubtitleSyncUpload,
  ) {
    return this.sync.start(dto, file);
  }

  @Get()
  list(@Query() query: ListSubtitleSyncDto) {
    return { tasks: this.sync.list(query.mediaItemId) };
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.sync.get(id);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.sync.cancel(id);
  }
}
