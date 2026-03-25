'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost, apiPut } from '@/lib/api';
import { type RuleDefinition, type SettingsPayload } from '@/lib/types';
import { PathBrowser } from '@/components/path-browser';
import { COMMON_LANGUAGES } from '@/lib/languages';

interface TokenUsageSummary {
  free: { promptTokens: number; completionTokens: number; totalTokens: number };
  paid: { promptTokens: number; completionTokens: number; totalTokens: number };
  deepSeekEstimatedCostUsd: number;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  const [openRouterKey, setOpenRouterKey] = useState('');
  const [deepSeekKey, setDeepSeekKey] = useState('');
  const [tokenSummary, setTokenSummary] = useState<TokenUsageSummary | null>(null);
  const [ruleDefinitions, setRuleDefinitions] = useState<RuleDefinition[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [settingsResponse, tokenUsageResponse, rulesResponse] = await Promise.all([
        apiGet<SettingsPayload>('/settings'),
        apiGet<TokenUsageSummary>('/settings/token-usage'),
        apiGet<RuleDefinition[]>('/rules'),
      ]);
      setSettings(settingsResponse);
      setTokenSummary(tokenUsageResponse);
      setRuleDefinitions(rulesResponse);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to load settings');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!settings) {
      return;
    }

    await apiPut('/settings', {
      mediaDirs: settings.mediaDirs,
      sourceLanguage: settings.sourceLanguage,
      targetLanguage: settings.targetLanguage,
      openRouterApiKey: openRouterKey,
      deepSeekApiKey: deepSeekKey,
      scanCacheTtlMinutes: settings.scanCacheTtlMinutes,
      concurrency: settings.concurrency,
      pathContainsExclusions: settings.pathContainsExclusions,
      fileTooLargeBytes: settings.fileTooLargeBytes,
      rules: settings.rules,
    });

    setOpenRouterKey('');
    setDeepSeekKey('');
    await load();
  };

  const reset = async () => {
    await apiPost('/settings/reset');
    await load();
  };

  if (!settings) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-sm text-on-surface-variant">Loading settings...</p>
      </div>
    );
  }

  return (
    <section className="space-y-8">
      {error ? (
        <div className="rounded-lg bg-error-container px-4 py-3 text-sm text-on-error-container border-l-4 border-error">
          {error}
        </div>
      ) : null}

      {/* Asymmetric Grid: Left = 7 cols, Right = 5 cols */}
      <div className="grid grid-cols-12 gap-8">
        {/* LEFT COLUMN: Media & Languages */}
        <div className="col-span-12 lg:col-span-7 space-y-8">
          {/* Media Folders */}
          <section className="bg-surface-container rounded-xl p-8 space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="section-label">Media Directories</h2>
              <button
                onClick={() => setSettings({ ...settings, mediaDirs: [...settings.mediaDirs, ''] })}
                className="text-secondary border border-secondary/30 px-3 py-1 rounded text-[10px] font-bold tracking-widest hover:bg-secondary/10 transition-colors"
              >
                ADD FOLDER
              </button>
            </div>
            <div className="space-y-3">
              {settings.mediaDirs.map((entry, index) => (
                <div
                  key={`dir-${index}`}
                  className="flex items-center gap-3 w-full group"
                >
                  <div className="flex-1">
                    <PathBrowser
                      value={entry}
                      onChange={(newPath) => {
                        const updated = [...settings.mediaDirs];
                        updated[index] = newPath;
                        setSettings({ ...settings, mediaDirs: updated });
                      }}
                      placeholder="Select media directory..."
                    />
                  </div>
                  <button
                    onClick={() => {
                      const updated = settings.mediaDirs.filter((_, itemIndex) => itemIndex !== index);
                      setSettings({ ...settings, mediaDirs: updated });
                    }}
                    className="material-symbols-outlined text-on-surface-variant hover:text-error transition-colors p-2 rounded-lg bg-surface-container-highest opacity-0 group-hover:opacity-100"
                    title="Remove directory"
                  >
                    close
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* Translation Defaults */}
          <section className="bg-surface-container rounded-xl p-8">
            <h2 className="section-label mb-6">Translation Defaults</h2>
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="field-label">Source Language</label>
                <div className="relative">
                  <select
                    value={settings.sourceLanguage}
                    onChange={(event) => setSettings({ ...settings, sourceLanguage: event.target.value })}
                    className="w-full engraved-input text-sm p-4 pr-10 rounded-lg text-on-surface appearance-none bg-surface-container-lowest cursor-pointer transition-all duration-200"
                  >
                    {COMMON_LANGUAGES.map((lang) => (
                      <option key={`src-${lang.code}`} value={lang.code}>
                        {lang.name} ({lang.code})
                      </option>
                    ))}
                  </select>
                  <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none">
                    expand_more
                  </span>
                </div>
              </div>
              <div className="space-y-2">
                <label className="field-label">Target Language</label>
                <div className="relative">
                  <select
                    value={settings.targetLanguage}
                    onChange={(event) => setSettings({ ...settings, targetLanguage: event.target.value })}
                    className="w-full engraved-input text-sm p-4 pr-10 rounded-lg text-on-surface appearance-none bg-surface-container-lowest cursor-pointer transition-all duration-200"
                  >
                    {COMMON_LANGUAGES.map((lang) => (
                      <option key={`tgt-${lang.code}`} value={lang.code}>
                        {lang.name} ({lang.code})
                      </option>
                    ))}
                  </select>
                  <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none">
                    expand_more
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* Token Usage */}
          <section className="grid grid-cols-2 gap-6">
            <div className="bg-surface-container-high p-6 rounded-xl relative overflow-hidden group">
              <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">FREE TIER</p>
              <h3 className="text-3xl font-black text-primary mt-2">{tokenSummary?.free.totalTokens ?? 0}</h3>
              <p className="text-[10px] font-mono mt-1 opacity-60">TOKENS USED</p>
            </div>
            <div className="bg-surface-container-high p-6 rounded-xl border-l-4 border-secondary/40">
              <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">DEEPSEEK PAID</p>
              <h3 className="text-3xl font-black text-secondary mt-2">{tokenSummary?.paid.totalTokens ?? 0}</h3>
              <div className="flex justify-between items-center mt-1">
                <p className="text-[10px] font-mono opacity-60">CURRENT SESSION</p>
                <span className="text-xs font-bold text-secondary">${tokenSummary?.deepSeekEstimatedCostUsd ?? 0} USD</span>
              </div>
            </div>
          </section>
        </div>

        {/* RIGHT COLUMN: API Keys, Rules, Paths */}
        <div className="col-span-12 lg:col-span-5 space-y-8">
          {/* API Keys */}
          <section className="bg-surface-container rounded-xl p-8 space-y-6">
            <h2 className="section-label">Neural Endpoints</h2>
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between">
                  <label className="field-label">OpenRouter API Key</label>
                  <span className="text-[9px] bg-primary/10 text-primary px-2 py-0.5 rounded uppercase font-black">
                    {settings.openRouterApiKeyMasked || 'UNSET'}
                  </span>
                </div>
                <input
                  type="password"
                  value={openRouterKey}
                  onChange={(event) => setOpenRouterKey(event.target.value)}
                  placeholder="sk-or-v1-xxxxxxxxxxxxxxxxxxxx"
                  className="w-full engraved-input text-xs p-4 rounded-lg text-on-surface"
                />
              </div>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="field-label">DeepSeek API Key</label>
                  <span className="text-[9px] border border-secondary/40 text-secondary px-2 py-0.5 rounded uppercase font-black">
                    PAID FALLBACK
                  </span>
                </div>
                <input
                  type="password"
                  value={deepSeekKey}
                  onChange={(event) => setDeepSeekKey(event.target.value)}
                  placeholder="sk-ds-xxxxxxxxxxxxxxxxxxxx"
                  className="w-full engraved-input text-xs p-4 rounded-lg text-on-surface"
                />
              </div>
            </div>
          </section>

          {/* Rules Engine */}
          <section className="bg-surface-container rounded-xl p-8 space-y-6">
            <h2 className="section-label">Skip Rules Engine</h2>
            <div className="space-y-6">
              {ruleDefinitions.map((ruleDefinition) => {
                const index = settings.rules.findIndex((rule) => rule.id === ruleDefinition.id);
                const enabled = index >= 0 ? settings.rules[index].enabled : ruleDefinition.enabled;

                return (
                  <div key={ruleDefinition.id} className="flex gap-4">
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(event) => {
                          const updated = [...settings.rules];
                          if (index >= 0) {
                            updated[index] = { ...updated[index], enabled: event.target.checked };
                          } else {
                            updated.push({ id: ruleDefinition.id, enabled: event.target.checked });
                          }
                          setSettings({ ...settings, rules: updated });
                        }}
                        className="sr-only peer"
                      />
                      <div className={`w-11 h-6 rounded-full transition-colors duration-200 ${
                        enabled ? 'bg-primary' : 'bg-surface-container-highest'
                      }`}>
                        <div className={`absolute top-0.5 w-5 h-5 bg-on-surface rounded-full transition-transform duration-200 ${
                          enabled ? 'translate-x-6' : 'translate-x-0.5'
                        }`} />
                      </div>
                    </label>
                    <div>
                      <p className="text-sm font-bold text-on-surface">{ruleDefinition.label}</p>
                      <p className="text-xs text-on-surface-variant leading-relaxed">{ruleDefinition.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Path Exclusions */}
          <section className="bg-surface-container rounded-xl p-8 space-y-6">
            <h2 className="section-label">Global Exclusions</h2>
            <div className="flex flex-wrap gap-2">
              {settings.pathContainsExclusions.map((entry, index) => (
                <span
                  key={`${entry}-${index}`}
                  className="bg-surface-container-high px-3 py-1.5 rounded-md text-[10px] font-mono text-on-surface-variant flex items-center gap-2"
                >
                  {entry}
                </span>
              ))}
            </div>
            <input
              placeholder="Add pattern (e.g. /pre-rolls/)"
              className="w-full engraved-input text-[10px] font-mono p-4 rounded-lg text-on-surface"
              onBlur={(event) => {
                const tokens = event.target.value
                  .split(',')
                  .map((entry) => entry.trim())
                  .filter((entry) => entry.length > 0);
                if (tokens.length > 0) {
                  setSettings({ ...settings, pathContainsExclusions: [...settings.pathContainsExclusions, ...tokens] });
                }
              }}
            />
          </section>
        </div>
      </div>

      {/* Footer Actions */}
      <footer className="flex items-center justify-between pt-4">
        <div className="flex gap-4">
          <button
            onClick={() => void apiPost('/library/rescan').then(load)}
            className="text-on-surface-variant hover:text-primary transition-colors text-[10px] font-black tracking-[0.2em] uppercase"
          >
            RESCAN LIBRARY
          </button>
        </div>
        <div className="flex gap-4">
          <button
            onClick={() => void reset()}
            className="bg-surface-container-high px-6 py-2.5 rounded text-xs font-bold tracking-widest text-on-surface hover:bg-surface-variant transition-colors"
          >
            RESET TO DEFAULTS
          </button>
          <button
            onClick={() => void save()}
            className="bg-gradient-to-br from-primary to-primary-container px-8 py-2.5 rounded text-xs font-black tracking-widest text-on-primary-container shadow-[0_0_15px_rgba(47,217,244,0.3)] hover:brightness-110 transition-all"
          >
            SAVE SETTINGS
          </button>
        </div>
      </footer>
    </section>
  );
}
