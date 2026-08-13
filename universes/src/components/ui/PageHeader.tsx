import Link from 'next/link';
import ThemeToggle from './ThemeToggle';

interface Props {
  title: string;
  subtitle?: string;
  backHref?: string;
  backLabel?: string;
  action?: React.ReactNode;
}

export default function PageHeader({
  title,
  subtitle,
  backHref = '/',
  backLabel = 'Вселенные',
  action,
}: Props) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center gap-3 px-5 py-3.5">
        <Link href={backHref} className="btn-quiet -ml-2 px-2 text-[13px]">
          ← {backLabel}
        </Link>

        <div className="min-w-0 flex-1 text-center">
          <h1 className="truncate font-display text-[17px] leading-tight text-ink">{title}</h1>
          {subtitle && <p className="truncate text-[12px] text-muted">{subtitle}</p>}
        </div>

        <div className="flex items-center gap-1">
          {action}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
