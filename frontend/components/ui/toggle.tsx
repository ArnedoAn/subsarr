'use client';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, label, description, disabled = false }: ToggleProps) {
  return (
    <label className={`flex items-start gap-3 ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
      <button
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        type="button"
        onClick={() => !disabled && onChange(!checked)}
        className={`toggle-track mt-0.5 ${checked ? 'active' : ''}`}
      >
        <span className="toggle-thumb" />
        <span className="sr-only">{label}</span>
      </button>
      {(label || description) && (
        <div className="flex-1 min-w-0">
          {label && <p className="text-sm font-medium text-on-surface leading-tight">{label}</p>}
          {description && <p className="text-xs text-on-surface-variant mt-0.5 leading-relaxed">{description}</p>}
        </div>
      )}
    </label>
  );
}
