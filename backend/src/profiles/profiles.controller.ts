import { Body, Controller, Get, Put } from '@nestjs/common';
import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ProfilesService } from './profiles.service';
import type { TranslationProfile } from './profile.types';
import type { TranslationProvider } from '../contracts/providers';

class ProfileDto implements TranslationProfile {
  @IsUUID()
  id!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  pathPrefix!: string;

  @IsString()
  @IsNotEmpty()
  sourceLanguage!: string;

  @IsString()
  @IsNotEmpty()
  targetLanguage!: string;

  @IsOptional()
  @IsIn(['openrouter', 'deepseek', 'opencode-go'])
  provider?: TranslationProvider;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9._:/+@-]*$/)
  model?: string;
}

class PutProfilesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProfileDto)
  profiles!: ProfileDto[];
}

@Controller('profiles')
export class ProfilesController {
  constructor(private readonly profilesService: ProfilesService) {}

  @Get()
  async getAll() {
    return { profiles: await this.profilesService.list() };
  }

  @Put()
  async putAll(@Body() body: PutProfilesDto) {
    await this.profilesService.save(body.profiles);
    return { profiles: await this.profilesService.list() };
  }
}
