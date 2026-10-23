import { type ReactNode } from 'react';

export function SettingsField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="block space-y-1.5"><span className="field-label">{label}</span>{children}{hint && <span className="block text-xs text-on-surface-variant">{hint}</span>}</label>;
}

export const settingsInputClass = 'w-full engraved-input text-sm px-3 py-2';

export function SettingsNumberField({ label, value, onChange, badInput = false, min = 0, max, optional = false, integer = false, hint }: {
  label: string; value: string; onChange: (value: string, badInput: boolean) => void; badInput?: boolean; min?: number; max: number; optional?: boolean; integer?: boolean; hint?: string;
}) {
  const number = Number(value);
  const invalid = badInput || (value !== '' && (!Number.isFinite(number) || number < min || number > max || (integer && !Number.isInteger(number))));
  const message = invalid ? `Enter ${integer ? 'a whole number' : 'a number'} between ${min} and ${max.toLocaleString()}.` : !optional && value === '' ? 'This field is required.' : '';
  return <SettingsField label={label} hint={hint}><input aria-label={label} aria-invalid={!!message} type="number" min={min} max={max} step={integer ? 1 : 'any'} required={!optional} value={value} onChange={e => onChange(e.currentTarget.value, e.currentTarget.validity.badInput)} className={settingsInputClass} />{message && <span role="alert" className="block text-xs text-error">{message}</span>}</SettingsField>;
}
