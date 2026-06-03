interface FilterChipProps {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}

export function FilterChip({ active = false, onClick, children }: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap border transition-colors ${
        active
          ? 'bg-primary/10 border-primary/35 text-primary'
          : 'bg-surface-container-high border-outline-variant/30 text-on-surface-variant'
      }`}
    >
      {children}
    </button>
  );
}
