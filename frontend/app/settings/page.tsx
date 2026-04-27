'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost, apiPut } from '@/lib/api';
import { type RuleDefinition, type SettingsPayload } from '@/lib/types';
import { PathBrowser } from '@/components/path-browser';
import { COMMON_LANGUAGES } from '@/lib/languages';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { useToast } from '@/components/ui/toast';

interface TokenUsageSummary {
  free: { promptTokens: number; completionTokens: number; totalTokens: number };
  paid: { promptTokens: number; completionTokens: number; totalTokens: number };
  deepSeekEstimatedCostUsd: number;
}

type TabId = 'general' | 'apikeys' | 'rules' | 'telegram' | 'advanced';

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'general',  label: 'General',  icon: 'tune'         },
  { id: 'apikeys',  label: 'API Keys', icon: 'key'          },
  { id: 'rules',    label: 'Rules',    icon: 'rule'         },
  { id: 'telegram', label: 'Telegram', icon: 'send'         },
  { id: 'advanced', label: 'Advanced', icon: 'settings'     },
];

const TELEGRAM_EVENT_OPTIONS: { id: string; label: string }[] = [
  { id: 'job.completed', label: 'Job completado' },
  { id: 'job.failed', label: 'Job fallido' },
  { id: 'scan.completed', label: 'Escaneo automático terminado' },
  { id: 'quota.warning', label: 'Aviso de cuota (~80%)' },
  { id: 'quota.reached', label: 'Cuota alcanzada' },
];

export default function SettingsPage() {
  const { success, error: toastError } = useToast();
  const [settings, setSettings]           = useState<SettingsPayload | null>(null);
  const [openRouterKey, setOpenRouterKey] = useState('');
  const [deepSeekKey, setDeepSeekKey]     = useState('');
  const [telegramToken, setTelegramToken] = useState('');
  const [jellyfinKey, setJellyfinKey]     = useState('');
  const [telegramStatus, setTelegramStatus] = useState<{
    ok: boolean;
    botOk: boolean;
    chatOk: boolean;
    botUsername?: string;
    error?: string;
  } | null>(null);
  const [tokenSummary, setTokenSummary]   = useState<TokenUsageSummary | null>(null);
  const [ruleDefinitions, setRuleDefinitions] = useState<RuleDefinition[]>([]);
  const [activeTab, setActiveTab]         = useState<TabId>('general');
  const [saving, setSaving]               = useState(false);
  const [newExclusion, setNewExclusion]   = useState('');

  const load = useCallback(async () => {
    try {
      const [settingsRes, tokenRes, rulesRes] = await Promise.all([
        apiGet<SettingsPayload>('/settings'),
        apiGet<TokenUsageSummary>('/settings/token-usage'),
        apiGet<RuleDefinition[]>('/rules'),
      ]);
      setSettings({
        ...settingsRes,
        openRouterModel: settingsRes.openRouterModel ?? 'openrouter/free',
        deepSeekModel: settingsRes.deepSeekModel ?? 'deepseek-chat',
        autoScanCronExpression: settingsRes.autoScanCronExpression ?? '0 */6 * * *',
        telegramEvents: settingsRes.telegramEvents ?? [],
        telegramBotTokenMasked: settingsRes.telegramBotTokenMasked ?? '',
        telegramEnabled: settingsRes.telegramEnabled ?? false,
        jellyfinApiKeyMasked: settingsRes.jellyfinApiKeyMasked ?? '',
        autoScanEnabled: settingsRes.autoScanEnabled ?? false,
        autoTranslateNewItems: settingsRes.autoTranslateNewItems ?? false,
      });
      setTokenSummary(tokenRes);
      setRuleDefinitions(rulesRes);
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to load settings');
    }
  }, [toastError]);

  useEffect(() => { void load(); }, [load]);

  const refreshTelegramStatus = useCallback(async () => {
    try {
      const s = await apiGet<{
        ok: boolean;
        botOk: boolean;
        chatOk: boolean;
        botUsername?: string;
        error?: string;
      }>('/settings/telegram/status');
      setTelegramStatus(s);
    } catch {
      setTelegramStatus({ ok: false, botOk: false, chatOk: false, error: 'No se pudo consultar' });
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'telegram') {
      void refreshTelegramStatus();
    }
  }, [activeTab, refreshTelegramStatus]);

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      await apiPut('/settings', {
        mediaDirs: settings.mediaDirs,
        sourceLanguage: settings.sourceLanguage,
        targetLanguage: settings.targetLanguage,
        openRouterApiKey: openRouterKey || undefined,
        deepSeekApiKey: deepSeekKey || undefined,
        openRouterModel: settings.openRouterModel,
        deepSeekModel: settings.deepSeekModel,
        scanCacheTtlMinutes: settings.scanCacheTtlMinutes,
        concurrency: settings.concurrency,
        pathContainsExclusions: settings.pathContainsExclusions,
        fileTooLargeBytes: settings.fileTooLargeBytes,
        translationVerificationEnabled: settings.translationVerificationEnabled,
        rules: settings.rules,
        autoScanEnabled: settings.autoScanEnabled,
        autoScanCronExpression: settings.autoScanCronExpression,
        autoTranslateNewItems: settings.autoTranslateNewItems,
        telegramBotToken: telegramToken || undefined,
        telegramChatId: settings.telegramChatId,
        telegramEnabled: settings.telegramEnabled,
        telegramEvents: settings.telegramEvents,
        dailyTokenLimitFree: settings.dailyTokenLimitFree,
        dailyTokenLimitPaid: settings.dailyTokenLimitPaid,
        monthlyBudgetUsd: settings.monthlyBudgetUsd,
        jellyfinUrl: settings.jellyfinUrl,
        jellyfinApiKey: jellyfinKey || undefined,
      });
      setOpenRouterKey('');
      setDeepSeekKey('');
      setTelegramToken('');
      setJellyfinKey('');
      success('Settings saved successfully');
      await load();
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    try {
      await apiPost('/settings/reset');
      success('Settings reset to defaults');
      await load();
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Reset failed');
    }
  };

  if (!settings) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex items-center gap-3 text-on-surface-variant">
          <span className="material-symbols-outlined text-[20px] animate-spin">progress_activity</span>
          <span className="text-sm">Loading settings…</span>
        </div>
      </div>
    );
  }

  return (
    <section className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-on-surface tracking-tight">Settings</h1>
          <p className="text-sm text-on-surface-variant mt-0.5">Configure your translation preferences</p>
        </div>
      </div>

      {/* Tabs + Content */}
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Tab navigation */}
        <nav className="flex lg:flex-col gap-1 lg:w-44 flex-shrink-0">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-all text-left
                ${activeTab === tab.id
                  ? 'bg-primary/10 text-primary'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
                }`}
            >
              <span
                className="material-symbols-outlined text-[18px] flex-shrink-0"
                style={{ fontVariationSettings: activeTab === tab.id ? 'FILL 1' : 'FILL 0' }}
              >
                {tab.icon}
              </span>
              {tab.label}
            </button>
          ))}
        </nav>

        {/* Tab content */}
        <div className="flex-1 min-w-0 space-y-6">

          {/* GENERAL TAB */}
          {activeTab === 'general' && (
            <>
              {/* Media Directories */}
              <div className="bg-surface-container rounded-lg p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-on-surface">Media Directories</h2>
                    <p className="text-xs text-on-surface-variant mt-0.5">Folders to scan for media files</p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    iconLeft="add"
                    onClick={() => setSettings({ ...settings, mediaDirs: [...settings.mediaDirs, ''] })}
                  >
                    Add
                  </Button>
                </div>
                <div className="space-y-2">
                  {settings.mediaDirs.map((dir, idx) => (
                    <div key={idx} className="flex items-center gap-2 group">
                      <div className="flex-1">
                        <PathBrowser
                          value={dir}
                          onChange={newPath => {
                            const updated = [...settings.mediaDirs];
                            updated[idx] = newPath;
                            setSettings({ ...settings, mediaDirs: updated });
                          }}
                          placeholder="Select or type a directory path…"
                        />
                      </div>
                      <button
                        onClick={() => {
                          const updated = settings.mediaDirs.filter((_, i) => i !== idx);
                          setSettings({ ...settings, mediaDirs: updated });
                        }}
                        className="btn btn-ghost btn-icon btn-sm text-on-surface-variant hover:text-error opacity-0 group-hover:opacity-100 transition-all"
                        title="Remove"
                      >
                        <span className="material-symbols-outlined text-[18px]">delete</span>
                      </button>
                    </div>
                  ))}
                  {settings.mediaDirs.length === 0 && (
                    <p className="text-sm text-on-surface-variant text-center py-4">
                      No directories configured. Add one to get started.
                    </p>
                  )}
                </div>
              </div>

              {/* Translation Defaults */}
              <div className="bg-surface-container rounded-lg p-6 space-y-4">
                <div>
                  <h2 className="text-sm font-semibold text-on-surface">Translation Defaults</h2>
                  <p className="text-xs text-on-surface-variant mt-0.5">Default language pair for new translation jobs</p>
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="field-label">Source Language</label>
                    <div className="relative">
                      <select
                        value={settings.sourceLanguage}
                        onChange={e => setSettings({ ...settings, sourceLanguage: e.target.value })}
                        className="w-full engraved-input text-sm px-3 py-2.5 pr-8 appearance-none cursor-pointer"
                      >
                        {COMMON_LANGUAGES.map(l => (
                          <option key={l.code} value={l.code}>{l.name} ({l.code})</option>
                        ))}
                      </select>
                      <span className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 text-[16px] text-on-surface-variant pointer-events-none">expand_more</span>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="field-label">Target Language</label>
                    <div className="relative">
                      <select
                        value={settings.targetLanguage}
                        onChange={e => setSettings({ ...settings, targetLanguage: e.target.value })}
                        className="w-full engraved-input text-sm px-3 py-2.5 pr-8 appearance-none cursor-pointer"
                      >
                        {COMMON_LANGUAGES.map(l => (
                          <option key={l.code} value={l.code}>{l.name} ({l.code})</option>
                        ))}
                      </select>
                      <span className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 text-[16px] text-on-surface-variant pointer-events-none">expand_more</span>
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-outline-variant/15">
                  <Toggle
                    checked={settings.translationVerificationEnabled}
                    onChange={v => setSettings({ ...settings, translationVerificationEnabled: v })}
                    label="Translation Verification"
                    description="Verifies translated lines using language detection. Failed lines are re-translated up to 2 times."
                  />
                </div>
              </div>
            </>
          )}

          {/* API KEYS TAB */}
          {activeTab === 'apikeys' && (
            <>
              <div className="bg-surface-container rounded-lg p-6 space-y-5">
                <div>
                  <h2 className="text-sm font-semibold text-on-surface">API Keys</h2>
                  <p className="text-xs text-on-surface-variant mt-0.5">Configure your translation providers</p>
                </div>

                {/* OpenRouter */}
                <div className="space-y-2 pb-4 border-b border-outline-variant/15">
                  <div className="space-y-1.5">
                    <label className="field-label">OpenRouter model ID</label>
                    <input
                      type="text"
                      value={settings.openRouterModel}
                      onChange={e => setSettings({ ...settings, openRouterModel: e.target.value })}
                      placeholder="openrouter/free"
                      className="w-full engraved-input text-sm px-3 py-2 font-mono"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="field-label">OpenRouter API Key</label>
                    <span className={`text-xs px-2 py-0.5 rounded font-semibold ${
                      settings.openRouterApiKeyMasked ? 'bg-success/10 text-success border border-success/20' : 'bg-surface-container-high text-on-surface-variant border border-outline-variant'
                    }`}>
                      {settings.openRouterApiKeyMasked || 'Not set'}
                    </span>
                  </div>
                  <input
                    type="password"
                    value={openRouterKey}
                    onChange={e => setOpenRouterKey(e.target.value)}
                    placeholder="sk-or-v1-xxxxxxxxxxxxxxxxxxxx"
                    className="w-full engraved-input text-sm px-3 py-2.5 font-mono"
                    autoComplete="off"
                  />
                  <p className="text-xs text-on-surface-variant">Primary provider. Free tier available.</p>
                </div>

                {/* DeepSeek */}
                <div className="space-y-2">
                  <div className="space-y-1.5">
                    <label className="field-label">DeepSeek model ID</label>
                    <input
                      type="text"
                      value={settings.deepSeekModel}
                      onChange={e => setSettings({ ...settings, deepSeekModel: e.target.value })}
                      placeholder="deepseek-chat"
                      className="w-full engraved-input text-sm px-3 py-2 font-mono"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="field-label">DeepSeek API Key</label>
                    <span className={`text-xs px-2 py-0.5 rounded font-semibold ${
                      settings.deepSeekApiKeyMasked ? 'bg-success/10 text-success border border-success/20' : 'bg-surface-container-high text-on-surface-variant border border-outline-variant'
                    }`}>
                      {settings.deepSeekApiKeyMasked || 'Not set'}
                    </span>
                  </div>
                  <input
                    type="password"
                    value={deepSeekKey}
                    onChange={e => setDeepSeekKey(e.target.value)}
                    placeholder="sk-xxxxxxxxxxxxxxxxxxxx"
                    className="w-full engraved-input text-sm px-3 py-2.5 font-mono"
                    autoComplete="off"
                  />
                  <p className="text-xs text-on-surface-variant">Paid fallback provider.</p>
                </div>
              </div>

              {/* Token Usage */}
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="bg-surface-container rounded-lg p-5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant mb-2">Free Tier Usage</p>
                  <p className="text-3xl font-bold text-primary">{(tokenSummary?.free.totalTokens ?? 0).toLocaleString()}</p>
                  <p className="text-xs text-on-surface-variant mt-1">tokens used</p>
                </div>
                <div className="bg-surface-container rounded-lg p-5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant mb-2">DeepSeek Paid</p>
                  <p className="text-3xl font-bold text-warning">{(tokenSummary?.paid.totalTokens ?? 0).toLocaleString()}</p>
                  <p className="text-xs text-on-surface-variant mt-1">
                    tokens · <span className="text-warning font-semibold">${tokenSummary?.deepSeekEstimatedCostUsd ?? 0} USD</span>
                  </p>
                </div>
              </div>
            </>
          )}

          {/* TELEGRAM TAB */}
          {activeTab === 'telegram' && (
            <div className="bg-surface-container rounded-lg p-6 space-y-5">
              <div>
                <h2 className="text-sm font-semibold text-on-surface">Telegram Bot</h2>
                <p className="text-xs text-on-surface-variant mt-0.5">
                  Notificaciones vía API HTTP (sin dependencias extra). Crea un bot con @BotFather, envía un mensaje al bot y obtén tu chat ID con @userinfobot o{' '}
                  <code className="font-mono text-[11px]">getUpdates</code>.
                </p>
              </div>
              <Toggle
                checked={settings.telegramEnabled}
                onChange={v => setSettings({ ...settings, telegramEnabled: v })}
                label="Activar notificaciones Telegram"
              />
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="field-label">Bot token</label>
                  <span className={`text-xs px-2 py-0.5 rounded font-semibold ${
                    settings.telegramBotTokenMasked ? 'bg-success/10 text-success border border-success/20' : 'bg-surface-container-high text-on-surface-variant'
                  }`}>
                    {settings.telegramBotTokenMasked || 'No configurado'}
                  </span>
                </div>
                <input
                  type="password"
                  value={telegramToken}
                  onChange={e => setTelegramToken(e.target.value)}
                  placeholder="123456789:AAH..."
                  className="w-full engraved-input text-sm px-3 py-2 font-mono"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1.5">
                <label className="field-label">Chat ID</label>
                <input
                  type="text"
                  value={settings.telegramChatId ?? ''}
                  onChange={e => setSettings({ ...settings, telegramChatId: e.target.value })}
                  placeholder="ej. 123456789 o -100..."
                  className="w-full engraved-input text-sm px-3 py-2 font-mono"
                />
              </div>
              <div>
                <p className="text-xs font-semibold text-on-surface-variant mb-2">Eventos</p>
                <div className="space-y-2">
                  {TELEGRAM_EVENT_OPTIONS.map(opt => {
                    const on = settings.telegramEvents.includes(opt.id);
                    return (
                      <Toggle
                        key={opt.id}
                        checked={on}
                        onChange={v => {
                          const next = new Set(settings.telegramEvents);
                          if (v) {
                            next.add(opt.id);
                          } else {
                            next.delete(opt.id);
                          }
                          setSettings({ ...settings, telegramEvents: [...next] });
                        }}
                        label={opt.label}
                      />
                    );
                  })}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <Button
                  variant="secondary"
                  size="sm"
                  iconLeft="send"
                  onClick={async () => {
                    try {
                      const r = await apiPost<{ ok: boolean; error?: string }>('/settings/telegram/test');
                      if (r.ok) {
                        success('Mensaje de prueba enviado');
                      } else {
                        toastError(r.error ?? 'Fallo al enviar');
                      }
                    } catch (e) {
                      toastError(e instanceof Error ? e.message : 'Error');
                    }
                  }}
                >
                  Enviar prueba
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  iconLeft="refresh"
                  onClick={() => void refreshTelegramStatus()}
                >
                  Comprobar conexión
                </Button>
              </div>
              {telegramStatus && (
                <div
                  className={`rounded-lg border px-3 py-2 text-sm ${
                    telegramStatus.ok
                      ? 'border-success/30 bg-success/8 text-success'
                      : 'border-warning/30 bg-warning/8 text-warning'
                  }`}
                >
                  <p className="font-medium">
                    {telegramStatus.ok ? 'Conexión OK' : 'Conexión incompleta'}
                  </p>
                  {telegramStatus.botUsername && (
                    <p className="text-xs mt-1 opacity-90">@{telegramStatus.botUsername}</p>
                  )}
                  {telegramStatus.error && (
                    <p className="text-xs mt-1">{telegramStatus.error}</p>
                  )}
                  <p className="text-[11px] mt-1 opacity-80">
                    Bot: {telegramStatus.botOk ? 'sí' : 'no'} · Chat: {telegramStatus.chatOk ? 'sí' : 'no'}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* RULES TAB */}
          {activeTab === 'rules' && (
            <div className="bg-surface-container rounded-lg p-6 space-y-5">
              <div>
                <h2 className="text-sm font-semibold text-on-surface">Skip Rules Engine</h2>
                <p className="text-xs text-on-surface-variant mt-0.5">Configure when to skip translation automatically</p>
              </div>
              <div className="space-y-5">
                {ruleDefinitions.map(def => {
                  const idx     = settings.rules.findIndex(r => r.id === def.id);
                  const enabled = idx >= 0 ? settings.rules[idx].enabled : def.enabled;
                  return (
                    <Toggle
                      key={def.id}
                      checked={enabled}
                      onChange={v => {
                        const updated = [...settings.rules];
                        if (idx >= 0) updated[idx] = { ...updated[idx], enabled: v };
                        else updated.push({ id: def.id, enabled: v });
                        setSettings({ ...settings, rules: updated });
                      }}
                      label={def.label}
                      description={def.description}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* ADVANCED TAB */}
          {activeTab === 'advanced' && (
            <>
              <div className="bg-surface-container rounded-lg p-6 space-y-4">
                <div>
                  <h2 className="text-sm font-semibold text-on-surface">Library auto-scan</h2>
                  <p className="text-xs text-on-surface-variant mt-0.5">
                    Re-scan media folders on a schedule (cron). New files detected vs the previous cache can be auto-queued for translation.
                  </p>
                </div>
                <Toggle
                  checked={settings.autoScanEnabled}
                  onChange={v => setSettings({ ...settings, autoScanEnabled: v })}
                  label="Enable scheduled rescan"
                  description="Uses the cron expression below (server timezone)."
                />
                <div className="space-y-1.5">
                  <label className="field-label">Cron expression</label>
                  <input
                    type="text"
                    value={settings.autoScanCronExpression}
                    onChange={e => setSettings({ ...settings, autoScanCronExpression: e.target.value })}
                    placeholder="0 */6 * * *"
                    className="w-full engraved-input text-sm px-3 py-2 font-mono"
                  />
                  <p className="text-xs text-on-surface-variant">Example: every 6 hours → <code className="font-mono">0 */6 * * *</code></p>
                </div>
                <Toggle
                  checked={settings.autoTranslateNewItems}
                  onChange={v => setSettings({ ...settings, autoTranslateNewItems: v })}
                  label="Auto-translate new items"
                  description="When a scheduled scan finds files that were not in the library cache, enqueue translation if rules allow (embedded source track must match default source language)."
                />
              </div>

              <div className="bg-surface-container rounded-lg p-6 space-y-4">
                <div>
                  <h2 className="text-sm font-semibold text-on-surface">Performance</h2>
                  <p className="text-xs text-on-surface-variant mt-0.5">Scan and processing settings</p>
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="field-label">Scan Cache TTL (minutes)</label>
                    <input
                      type="number"
                      min={1}
                      value={settings.scanCacheTtlMinutes}
                      onChange={e => setSettings({ ...settings, scanCacheTtlMinutes: Number(e.target.value) })}
                      className="w-full engraved-input text-sm px-3 py-2"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="field-label">Concurrency</label>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={settings.concurrency}
                      onChange={e => setSettings({ ...settings, concurrency: Number(e.target.value) })}
                      className="w-full engraved-input text-sm px-3 py-2"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="field-label">Max File Size (bytes)</label>
                    <input
                      type="number"
                      min={0}
                      value={settings.fileTooLargeBytes ?? ''}
                      onChange={e => setSettings({ ...settings, fileTooLargeBytes: e.target.value ? Number(e.target.value) : undefined })}
                      placeholder="No limit"
                      className="w-full engraved-input text-sm px-3 py-2"
                    />
                    <p className="text-xs text-on-surface-variant">Files larger than this will be skipped</p>
                  </div>
                </div>
              </div>

              {/* Path Exclusions */}
              <div className="bg-surface-container rounded-lg p-6 space-y-4">
                <div>
                  <h2 className="text-sm font-semibold text-on-surface">Path Exclusions</h2>
                  <p className="text-xs text-on-surface-variant mt-0.5">Files containing these patterns will be skipped</p>
                </div>
                <div className="flex flex-wrap gap-2 min-h-8">
                  {settings.pathContainsExclusions.map((entry, idx) => (
                    <span
                      key={idx}
                      className="flex items-center gap-1.5 bg-surface-container-high border border-outline-variant/30 px-2.5 py-1 rounded text-xs font-mono text-on-surface"
                    >
                      {entry}
                      <button
                        onClick={() => {
                          const updated = settings.pathContainsExclusions.filter((_, i) => i !== idx);
                          setSettings({ ...settings, pathContainsExclusions: updated });
                        }}
                        className="text-on-surface-variant hover:text-error transition-colors"
                      >
                        <span className="material-symbols-outlined text-[14px]">close</span>
                      </button>
                    </span>
                  ))}
                  {settings.pathContainsExclusions.length === 0 && (
                    <span className="text-xs text-on-surface-variant/50">No exclusions configured</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <input
                    value={newExclusion}
                    onChange={e => setNewExclusion(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && newExclusion.trim()) {
                        setSettings({ ...settings, pathContainsExclusions: [...settings.pathContainsExclusions, newExclusion.trim()] });
                        setNewExclusion('');
                      }
                    }}
                    placeholder="e.g. /pre-rolls/ then press Enter"
                    className="flex-1 engraved-input text-sm px-3 py-2 font-mono"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    iconLeft="add"
                    onClick={() => {
                      if (newExclusion.trim()) {
                        setSettings({ ...settings, pathContainsExclusions: [...settings.pathContainsExclusions, newExclusion.trim()] });
                        setNewExclusion('');
                      }
                    }}
                  >
                    Add
                  </Button>
                </div>
              </div>
            </>
          )}

        </div>
      </div>

      {/* Footer Actions */}
      <div className="flex items-center justify-between pt-4 border-t border-outline-variant/15">
        <div className="flex gap-3">
          <button
            onClick={() =>
              void apiPost<{ accepted: boolean }>('/library/rescan')
                .then((res) => {
                  if (res.accepted) {
                    success('Library rescan started');
                  } else {
                    success('Library scan is already running');
                  }
                })
                .catch((err) => {
                  toastError(
                    err instanceof Error
                      ? err.message
                      : 'Failed to start library rescan',
                  );
                })
            }
            className="text-xs text-on-surface-variant hover:text-on-surface transition-colors flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">refresh</span>
            Rescan Library
          </button>
          <button
            onClick={() => void reset()}
            className="text-xs text-on-surface-variant hover:text-error transition-colors flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">restart_alt</span>
            Reset to Defaults
          </button>
        </div>
        <Button
          variant="primary"
          loading={saving}
          iconLeft={saving ? undefined : 'save'}
          onClick={() => void save()}
        >
          {saving ? 'Saving…' : 'Save Settings'}
        </Button>
      </div>
    </section>
  );
}
