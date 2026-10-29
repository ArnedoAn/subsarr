import { BadRequestException } from '@nestjs/common';
import type { TranslationProvider } from '../contracts/providers';

/** Documented OpenAI-compatible chat models only; not every Go model/protocol. */
export const OPENCODE_GO_CHAT_MODELS = [
  'glm-5.3-flash',
  'glm-5.3',
  'glm-5.2',
  'kimi-k3.1-pro',
  'kimi-k3',
  'kimi-k2.7-code',
  'longcat-2.0',
  'deepseek-v4.1-flash',
  'deepseek-v4-pro',
  'mimo-v2.6-flash',
  'mimo-v2.6-pro',
  'mimo-v2.5',
  'mimo-v2.5-pro',
  'minimax-m3.1-flash',
  'hy4-preview',
  'hy3',
  'longcat-2.5-preview-free',
  'step-5-preview',
  'beam-free',
].map((id) => ({ id, name: id }));

export interface ProviderModelSelection {
  provider?: TranslationProvider;
  model?: string;
}

export function validateProviderModel(
  provider: TranslationProvider | undefined,
  model: string,
): void {
  if (
    provider !== undefined &&
    !['openrouter', 'deepseek', 'opencode-go'].includes(provider)
  )
    throw new BadRequestException('Invalid translation provider');
  if (
    typeof model !== 'string' ||
    model.length > 128 ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:/+@-]*$/.test(model)
  )
    throw new BadRequestException('Invalid translation model identifier');
  if (
    provider === 'opencode-go' &&
    !OPENCODE_GO_CHAT_MODELS.some(({ id }) => id === model)
  )
    throw new BadRequestException(
      'OpenCode Go model is not a documented OpenAI-compatible chat model',
    );
}

export function resolveProviderModel(
  settings: {
    defaultProvider?: TranslationProvider;
    openRouterModel: string;
    deepSeekModel: string;
    opencodeGoModel?: string;
  },
  operation: ProviderModelSelection = {},
  profile: ProviderModelSelection = {},
): { provider: TranslationProvider; model: string } {
  const provider =
    operation.provider ??
    profile.provider ??
    settings.defaultProvider ??
    'openrouter';
  const savedModel =
    provider === 'opencode-go'
      ? (settings.opencodeGoModel ?? 'glm-5.2')
      : provider === 'deepseek'
        ? settings.deepSeekModel
        : settings.openRouterModel;
  const profileModel =
    profile.provider === provider || (!profile.provider && !operation.provider)
      ? profile.model
      : undefined;
  const model = operation.model ?? profileModel ?? savedModel;
  validateProviderModel(provider, model);
  return { provider, model };
}
