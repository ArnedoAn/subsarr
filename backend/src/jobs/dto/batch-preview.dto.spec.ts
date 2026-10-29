import { ValidationPipe } from '@nestjs/common';
import { BatchPreviewDto } from './batch-preview.dto';
import { CreateJobDto } from './create-job.dto';
import { CreateBatchJobsDto } from './create-batch-jobs.dto';
import { QuickTranslateDto } from '../../quick-translate/quick-translate.dto';

const payload = {
  items: [{ mediaItemId: 'media-1' }],
  sourceLanguage: 'eng',
  targetLanguage: 'spa',
  forceBypassRules: false,
};

const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});

const validatePreview = (body: Record<string, unknown>) =>
  pipe.transform(body, { type: 'body', metatype: BatchPreviewDto });

describe('Batch preview provider validation', () => {
  it.each(['openrouter', 'deepseek', 'opencode-go'])(
    'accepts a preview using %s',
    async (provider) => {
      await expect(validatePreview({ ...payload, provider })).resolves.toEqual({
        ...payload,
        provider,
      });
    },
  );

  it('accepts previews without an explicit provider', async () => {
    await expect(validatePreview(payload)).resolves.toEqual(payload);
  });

  it('rejects unsupported providers', async () => {
    await expect(
      validatePreview({ ...payload, provider: 'unsupported' }),
    ).rejects.toThrow('Bad Request');
  });

  it('preserves a Go model through the whitelist', async () => {
    await expect(
      validatePreview({
        ...payload,
        provider: 'opencode-go',
        model: 'glm-5.2',
      }),
    ).resolves.toEqual({
      ...payload,
      provider: 'opencode-go',
      model: 'glm-5.2',
    });
  });

  it.each(['', ' ', 'model with spaces', 'x'.repeat(129)])(
    'rejects invalid model %j',
    async (model) => {
      await expect(validatePreview({ ...payload, model })).rejects.toThrow(
        'Bad Request',
      );
    },
  );

  it('still rejects unknown request properties', async () => {
    await expect(
      validatePreview({ ...payload, unexpected: true }),
    ).rejects.toThrow('Bad Request');
  });
});

describe('Translation quality request validation', () => {
  const cases = [
    { dto: BatchPreviewDto, body: payload },
    {
      dto: CreateBatchJobsDto,
      body: {
        ...payload,
        items: [{ mediaItemId: 'media-1', sourceTrackIndex: 0 }],
        triggeredBy: 'batch',
      },
    },
    {
      dto: CreateJobDto,
      body: {
        mediaItemId: 'media-1',
        sourceTrackIndex: 0,
        sourceLanguage: 'eng',
        targetLanguage: 'spa',
        triggeredBy: 'manual',
      },
    },
    {
      dto: QuickTranslateDto,
      body: { requestId: 'request_quality_01', targetLanguage: 'spa' },
    },
  ];
  it.each(cases)(
    'preserves bounded quality options in $dto.name',
    async ({ dto, body }) => {
      const options = {
        qualityMode: 'review',
        contextHint: 'A comedy',
        useTranslationMemory: true,
      };
      await expect(
        pipe.transform(
          { ...body, ...options },
          { type: 'body', metatype: dto },
        ),
      ).resolves.toMatchObject(options);
    },
  );
  it.each(cases)(
    'rejects invalid quality mode, context and memory in $dto.name',
    async ({ dto, body }) => {
      for (const invalid of [
        { qualityMode: 'unknown' },
        { contextHint: 'x'.repeat(12001) },
        { useTranslationMemory: 'yes' },
      ]) {
        await expect(
          pipe.transform(
            { ...body, ...invalid },
            { type: 'body', metatype: dto },
          ),
        ).rejects.toThrow('Bad Request');
      }
    },
  );
  it('parses explicit multipart memory booleans without treating false as truthy', async () => {
    await expect(
      pipe.transform(
        {
          requestId: 'request_quality_01',
          targetLanguage: 'spa',
          useTranslationMemory: 'false',
        },
        { type: 'body', metatype: QuickTranslateDto },
      ),
    ).resolves.toMatchObject({ useTranslationMemory: false });
  });
});
