/** Diagnostic text must never echo credentials embedded in infrastructure errors. */
export function diagnosticText(value: string): string {
  return value
    .replace(/\b(?:https?|redis|rediss|postgres(?:ql)?|mysql|amqps?):\/\/[^\s<>"']+/gi, '[connection redacted]')
    .replace(/\bBearer\s+[^\s,;"']+/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk|pk|rk|gsk)[-_][A-Za-z0-9_-]{8,}/gi, '[redacted]')
    .replace(/\b(api[-_ ]?key|token|password|secret|authorization)["']?\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)/gi, '$1=[redacted]');
}

export function diagnosticDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return 'Unavailable';
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
  return `${(milliseconds / 1000).toFixed(1)} s`;
}

/** Never turn malformed server counters into misleading negative/NaN chart values. */
export function numericDiagnostics(value: object): [string, number][] {
  return Object.entries(value).filter((entry): entry is [string, number] =>
    typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] >= 0,
  );
}

export function diagnosticBasename(path: string): string {
  return diagnosticText(path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '(root)');
}
