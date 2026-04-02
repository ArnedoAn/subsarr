type BadgeVariant = 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'neutral';

interface BadgeProps {
  variant?: BadgeVariant;
  icon?: string;
  children: React.ReactNode;
  className?: string;
}

const variantMap: Record<BadgeVariant, string> = {
  primary:   'badge-primary',
  secondary: 'badge-secondary',
  success:   'badge-success',
  warning:   'badge-warning',
  error:     'badge-error',
  neutral:   'badge-neutral',
};

export function Badge({ variant = 'neutral', icon, children, className = '' }: BadgeProps) {
  return (
    <span className={`badge ${variantMap[variant]} ${className}`}>
      {icon && (
        <span className="material-symbols-outlined text-[13px]" style={{ fontVariationSettings: 'FILL 1' }}>
          {icon}
        </span>
      )}
      {children}
    </span>
  );
}
