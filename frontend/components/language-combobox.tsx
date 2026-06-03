'use client';

import { COMMON_LANGUAGES } from '@/lib/languages';
import { getRecentLanguages } from '@/lib/recent-languages';
import { Combobox } from '@/components/ui/combobox';

const LANGUAGE_OPTIONS = COMMON_LANGUAGES.map((l) => ({
  value: l.code,
  label: l.name,
  hint: l.code.toUpperCase(),
}));

interface LanguageComboboxProps {
  value: string;
  onChange: (code: string) => void;
  ariaLabel?: string;
  compact?: boolean;
  disabled?: boolean;
}

export function LanguageCombobox({
  value,
  onChange,
  ariaLabel,
  compact = false,
  disabled = false,
}: LanguageComboboxProps) {
  const recents = getRecentLanguages();

  return (
    <Combobox
      value={value}
      onChange={onChange}
      options={LANGUAGE_OPTIONS}
      placeholder="Search language…"
      emptyLabel="No language found"
      pinnedValues={recents}
      pinnedLabel="Recent"
      ariaLabel={ariaLabel}
      compact={compact}
      disabled={disabled}
    />
  );
}
