'use client';

import type { TranslationQualityMode } from '@/lib/types';

export interface QualitySelection { qualityMode: TranslationQualityMode; contextHint: string; useTranslationMemory: boolean }
export const INITIAL_QUALITY: QualitySelection = { qualityMode: 'fast', contextHint: '', useTranslationMemory: false };
export function TranslationQualityOptions({ value, onChange, disabled = false }: { value: QualitySelection; onChange: (value: QualitySelection) => void; disabled?: boolean }) {
  return <fieldset disabled={disabled} className="space-y-3">
    <label className="block text-sm">Quality mode<select className="engraved-input mt-1 w-full p-2" value={value.qualityMode} onChange={event => onChange({ ...value, qualityMode: event.target.value as TranslationQualityMode })}><option value="fast">Fast — direct translation</option><option value="balanced">Balanced — generate context first</option><option value="review">Review — context and suspect-cue review</option></select></label>
    <p className="text-xs text-on-surface-variant">Balanced generates a story/context sheet; Review additionally checks suspect cues. These modes make additional provider requests and consume tokens or subscription quota. Readability warnings are not guarantees of translation quality.</p>
    <label className="block text-sm">Translation context / style instructions<textarea className="engraved-input mt-1 min-h-24 w-full p-2" maxLength={12000} value={value.contextHint} onChange={event => onChange({ ...value, contextHint: event.target.value })} placeholder="Optional names, story context, tone or terminology…" /></label>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={value.useTranslationMemory} onChange={event => onChange({ ...value, useTranslationMemory: event.target.checked })} />Use manually approved translation memory</label>
    <p className="text-xs text-on-surface-variant">Memory reuse is opt-in and requires matching language, source and context. AI outputs are never automatically approved.</p>
  </fieldset>;
}
