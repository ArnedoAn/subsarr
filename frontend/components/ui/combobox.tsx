'use client';

import { useEffect, useRef, useState } from 'react';

export type ComboboxOption = { value: string; label: string; hint?: string };

export interface ComboboxProps {
  value: string;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  emptyLabel?: string;
  pinnedValues?: string[];
  pinnedLabel?: string;
  ariaLabel?: string;
  compact?: boolean;
  disabled?: boolean;
}

function highlight(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-primary/20 text-primary rounded-[2px]">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

export function Combobox({
  value,
  onChange,
  options,
  placeholder = 'Search…',
  emptyLabel = 'No results',
  pinnedValues = [],
  pinnedLabel = 'Recent',
  ariaLabel,
  compact = false,
  disabled = false,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = options.find((o) => o.value === value);

  const filterOption = (o: ComboboxOption) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      o.label.toLowerCase().includes(q) ||
      o.value.toLowerCase().includes(q) ||
      (o.hint ?? '').toLowerCase().includes(q)
    );
  };

  const pinned = pinnedValues
    .map((v) => options.find((o) => o.value === v))
    .filter((o): o is ComboboxOption => !!o && filterOption(o));

  const rest = options.filter(
    (o) => !pinnedValues.includes(o.value) && filterOption(o),
  );

  const flat: Array<ComboboxOption | 'divider'> =
    pinned.length > 0 && rest.length > 0
      ? [...pinned, 'divider', ...rest]
      : pinned.length > 0
        ? pinned
        : rest;

  const flatOptions = flat.filter((x): x is ComboboxOption => x !== 'divider');

  // click-outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const openDropdown = () => {
    if (disabled) return;
    setQuery('');
    setActiveIdx(-1);
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const select = (val: string) => {
    onChange(val);
    setOpen(false);
    setQuery('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDropdown(); }
      return;
    }
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, flatOptions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault();
      const opt = flatOptions[activeIdx];
      if (opt) select(opt.value);
    }
  };

  // scroll active item into view
  useEffect(() => {
    if (activeIdx < 0 || !listRef.current) return;
    const li = listRef.current.querySelectorAll<HTMLLIElement>('li[role="option"]')[activeIdx];
    li?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  const triggerClass = compact
    ? 'flex items-center gap-1 bg-transparent text-xs text-on-surface cursor-pointer focus:outline-none min-w-0'
    : 'w-full engraved-input text-sm px-3 py-2.5 pr-9 cursor-pointer text-left flex items-center justify-between';

  const displayLabel = selected
    ? compact
      ? selected.label
      : `${selected.label}${selected.hint ? ` (${selected.hint})` : ''}`
    : placeholder;

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={open ? () => setOpen(false) : openDropdown}
        onKeyDown={handleKeyDown}
        className={triggerClass}
      >
        <span className={`truncate flex-1 ${!selected ? 'text-on-surface-variant' : ''}`}>
          {displayLabel}
        </span>
        <span className={`material-symbols-outlined flex-shrink-0 text-on-surface-variant ${compact ? 'text-[14px]' : 'absolute right-2.5 top-1/2 -translate-y-1/2 text-[16px]'}`}>
          {open ? 'expand_less' : 'expand_more'}
        </span>
      </button>

      {open && (
        <div className="absolute z-50 w-full min-w-[200px] mt-1 bg-[var(--surface-container-high)] rounded-lg shadow-xl border border-outline-variant/20 overflow-hidden">
          {/* Search input */}
          <div className="px-2 py-2 border-b border-outline-variant/15">
            <div className="relative">
              <span className="material-symbols-outlined absolute left-2 top-1/2 -translate-y-1/2 text-[14px] text-on-surface-variant pointer-events-none">
                search
              </span>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setActiveIdx(-1); }}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                className="w-full engraved-input text-xs px-2 py-1.5 pl-7"
              />
            </div>
          </div>

          {/* Option list */}
          <ul
            ref={listRef}
            role="listbox"
            className="max-h-56 overflow-y-auto custom-scrollbar py-1"
          >
            {pinned.length > 0 && (
              <li className="px-3 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant/60 select-none">
                {pinnedLabel}
              </li>
            )}
            {flat.map((item) => {
              if (item === 'divider') {
                return (
                  <li key="divider" className="my-1 border-t border-outline-variant/20" role="separator" />
                );
              }
              const optIdx = flatOptions.indexOf(item);
              const isActive = optIdx === activeIdx;
              const isSelected = item.value === value;
              return (
                <li
                  key={item.value}
                  role="option"
                  aria-selected={isSelected}
                  onMouseDown={(e) => { e.preventDefault(); select(item.value); }}
                  onMouseEnter={() => setActiveIdx(optIdx)}
                  className={`flex items-center gap-2 px-3 py-2 cursor-pointer text-xs transition-colors ${
                    isActive ? 'bg-surface-container-highest' : 'hover:bg-surface-container-highest/60'
                  } ${isSelected ? 'text-primary font-medium' : 'text-on-surface'}`}
                >
                  {isSelected && (
                    <span className="material-symbols-outlined text-[13px] flex-shrink-0">check</span>
                  )}
                  {!isSelected && <span className="w-[13px] flex-shrink-0" />}
                  <span className="flex-1 min-w-0 truncate">
                    {highlight(item.label, query)}
                  </span>
                  {item.hint && !query && (
                    <span className="text-on-surface-variant/60 font-mono text-[10px] flex-shrink-0">{item.hint}</span>
                  )}
                </li>
              );
            })}
            {flat.length === 0 && (
              <li className="px-3 py-4 text-xs text-center text-on-surface-variant">{emptyLabel}</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
