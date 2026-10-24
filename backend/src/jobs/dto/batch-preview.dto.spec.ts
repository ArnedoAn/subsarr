import { ValidationPipe } from '@nestjs/common';
import { BatchPreviewDto } from './batch-preview.dto';

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
  it.each(['openrouter', 'deepseek'])(
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

  it('still rejects unknown request properties', async () => {
    await expect(
      validatePreview({ ...payload, unexpected: true }),
    ).rejects.toThrow('Bad Request');
  });
});
