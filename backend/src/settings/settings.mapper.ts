import { SettingEntity } from '../database/entities/setting.entity';
import { type RuntimeSettings, type RuleToggleConfig } from './settings.types';

export const SETTINGS_ROW_ID = 'main';

export function entityToRuntime(e: SettingEntity): RuntimeSettings {
  return {
    mediaDirs: JSON.parse(e.mediaDirsJson) as string[],
    sourceLanguage: e.sourceLanguage,
    targetLanguage: e.targetLanguage,
    openRouterApiKey: e.openRouterApiKey,
    deepSeekApiKey: e.deepSeekApiKey,
    openRouterModel: e.openRouterModel,
    deepSeekModel: e.deepSeekModel,
    scanCacheTtlMinutes: e.scanCacheTtlMinutes,
    concurrency: e.concurrency,
    pathContainsExclusions: JSON.parse(
      e.pathContainsExclusionsJson,
    ) as string[],
    fileTooLargeBytes: e.fileTooLargeBytes ?? undefined,
    translationVerificationEnabled: e.translationVerificationEnabled,
    rules: JSON.parse(e.rulesJson) as RuleToggleConfig[],
    autoScanEnabled: e.autoScanEnabled,
    autoScanCronExpression: e.autoScanCronExpression,
    autoTranslateNewItems: e.autoTranslateNewItems,
    telegramBotToken: e.telegramBotToken ?? undefined,
    telegramChatId: e.telegramChatId ?? undefined,
    telegramEnabled: e.telegramEnabled,
    telegramEvents: JSON.parse(e.telegramEventsJson || '[]') as string[],
    dailyTokenLimitFree: e.dailyTokenLimitFree ?? undefined,
    dailyTokenLimitPaid: e.dailyTokenLimitPaid ?? undefined,
    monthlyBudgetUsd: e.monthlyBudgetUsd ?? undefined,
    jellyfinUrl: e.jellyfinUrl ?? undefined,
    jellyfinApiKey: e.jellyfinApiKey ?? undefined,
  };
}

export function runtimeToEntity(r: RuntimeSettings): SettingEntity {
  const e = new SettingEntity();
  e.id = SETTINGS_ROW_ID;
  e.mediaDirsJson = JSON.stringify(r.mediaDirs);
  e.sourceLanguage = r.sourceLanguage;
  e.targetLanguage = r.targetLanguage;
  e.openRouterApiKey = r.openRouterApiKey;
  e.deepSeekApiKey = r.deepSeekApiKey;
  e.openRouterModel = r.openRouterModel;
  e.deepSeekModel = r.deepSeekModel;
  e.scanCacheTtlMinutes = r.scanCacheTtlMinutes;
  e.concurrency = r.concurrency;
  e.pathContainsExclusionsJson = JSON.stringify(r.pathContainsExclusions);
  e.fileTooLargeBytes = r.fileTooLargeBytes ?? null;
  e.translationVerificationEnabled = r.translationVerificationEnabled;
  e.rulesJson = JSON.stringify(r.rules);
  e.autoScanEnabled = r.autoScanEnabled;
  e.autoScanCronExpression = r.autoScanCronExpression;
  e.autoTranslateNewItems = r.autoTranslateNewItems;
  e.telegramBotToken = r.telegramBotToken ?? null;
  e.telegramChatId = r.telegramChatId ?? null;
  e.telegramEnabled = r.telegramEnabled;
  e.telegramEventsJson = JSON.stringify(r.telegramEvents);
  e.dailyTokenLimitFree = r.dailyTokenLimitFree ?? null;
  e.dailyTokenLimitPaid = r.dailyTokenLimitPaid ?? null;
  e.monthlyBudgetUsd = r.monthlyBudgetUsd ?? null;
  e.jellyfinUrl = r.jellyfinUrl ?? null;
  e.jellyfinApiKey = r.jellyfinApiKey ?? null;
  return e;
}
