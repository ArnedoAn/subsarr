const STORAGE_KEY = 'subsarr-recent-languages';
const MAX = 5;

export function getRecentLanguages(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

export function pushRecentLanguage(code: string): void {
  if (typeof window === 'undefined') return;
  try {
    const prev = getRecentLanguages().filter((c) => c !== code);
    const next = [code, ...prev].slice(0, MAX);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota / private mode */
  }
}
