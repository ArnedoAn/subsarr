interface ProgressBarProps {
  value: number;
  max?: number;
  className?: string;
  showLabel?: boolean;
  color?: 'primary' | 'success' | 'warning' | 'error';
}

const colorMap = {
  primary: 'bg-primary-container',
  success: 'bg-success',
  warning: 'bg-warning',
  error:   'bg-error',
};

export function ProgressBar({ value, max = 100, className = '', showLabel = false, color = 'primary' }: ProgressBarProps) {
  const pct = Math.min(Math.max(Math.round((value / max) * 100), 0), 100);

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="progress-bar-track flex-1">
        <div
          className={`progress-bar-fill ${colorMap[color]}`}
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={value}
          aria-valuemin={0}
          aria-valuemax={max}
        />
      </div>
      {showLabel && (
        <span className="text-xs font-mono text-on-surface-variant w-8 text-right">{pct}%</span>
      )}
    </div>
  );
}
