interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon = 'inbox', title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
      <span
        className="material-symbols-outlined text-[48px] text-on-surface-variant/40 mb-4"
        style={{ fontVariationSettings: 'FILL 0' }}
      >
        {icon}
      </span>
      <h3 className="text-base font-semibold text-on-surface mb-1">{title}</h3>
      {description && (
        <p className="text-sm text-on-surface-variant max-w-sm mb-6">{description}</p>
      )}
      {action}
    </div>
  );
}
