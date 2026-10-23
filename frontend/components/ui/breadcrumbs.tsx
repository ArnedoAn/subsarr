import Link from 'next/link';

interface Crumb {
  label: string;
  href?: string;
}

interface BreadcrumbsProps {
  items: Crumb[];
}

export function Breadcrumbs({ items }: BreadcrumbsProps) {
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 max-w-full items-center gap-1.5 text-sm overflow-hidden">
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={i} className={`flex min-w-0 items-center gap-1.5 ${isLast ? 'flex-1' : 'shrink-0 max-w-[40%]'}`}>
            {i > 0 && (
              <span className="material-symbols-outlined text-[14px] text-on-surface-variant">
                chevron_right
              </span>
            )}
            {item.href && !isLast ? (
              <Link
                href={item.href}
                className="truncate text-on-surface-variant hover:text-on-surface transition-colors font-medium"
              >
                {item.label}
              </Link>
            ) : (
              <span aria-current={isLast ? 'page' : undefined} title={item.label} className={`truncate ${isLast ? 'text-on-surface font-medium' : 'text-on-surface-variant'}`}>
                {item.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
