import { Body, Controller, Get, Put } from '@nestjs/common';
import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ProfilesService } from './profiles.service';
import type { TranslationProfile } from './profile.types';

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
  @IsIn(['openrouter', 'deepseek'])
  provider?: 'openrouter' | 'deepseek';
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
