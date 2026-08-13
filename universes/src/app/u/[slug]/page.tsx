import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import PageHeader from '@/components/ui/PageHeader';
import { BOARD_KIND_LIST, PATH_BY_KIND, UNIVERSES, isUniverse } from '@/lib/constants';
import { currentProfile } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function UniversePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isUniverse(slug)) notFound();

  const me = await currentProfile();
  if (!me) redirect('/vhod');

  const universe = UNIVERSES[slug];
  const isMine = me.slug === slug;

  return (
    <main className="min-h-dvh pb-20">
      <PageHeader
        title={universe.title}
        subtitle={isMine ? 'Ваше пространство' : `Пространство ${universe.possessive}`}
      />

      <div className="mx-auto max-w-3xl px-5 py-6">
        <div className="grid gap-3 sm:grid-cols-2">
          <ModuleCard
            href={`/u/${slug}/drevo`}
            title="Генеалогическое древо"
            hint="Родные, связи, адреса и телефоны"
            span
          />

          {BOARD_KIND_LIST.map((kind) => (
            <ModuleCard
              key={kind.key}
              href={`/u/${slug}/spisok/${PATH_BY_KIND[kind.key]}`}
              title={kind.title}
              hint={kind.hint}
            />
          ))}
        </div>

        {!isMine && (
          <p className="mt-4 rounded-soft border border-line bg-raised/50 px-4 py-3 text-[13px] text-muted">
            Личные записи {universe.possessive} видит только {universe.name}. Здесь вам открыто
            общее: древо и всё, что помечено как «Общее».
          </p>
        )}

        <div className="mt-8">
          <p className="mb-2 text-[13px] text-muted">Общее для двоих</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <ModuleCard href="/poetika" title="Поэтика" hint="Лента и ветки" />
            <ModuleCard href="/chat" title="Чат" hint="Текст и голосовые" />
            <ModuleCard href="/galereya" title="Галерея" hint="Фото и видео" />
          </div>
        </div>
      </div>
    </main>
  );
}

function ModuleCard({
  href,
  title,
  hint,
  span = false,
}: {
  href: string;
  title: string;
  hint: string;
  span?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`card group flex flex-col justify-between p-5 transition hover:shadow-lift ${
        span ? 'sm:col-span-2' : ''
      }`}
    >
      <h2 className="font-display text-[19px] text-ink">{title}</h2>
      <p className="mt-1 text-[13px] text-muted">{hint}</p>
      <span className="mt-4 text-[13px] text-rose opacity-0 transition group-hover:opacity-100">
        Открыть →
      </span>
    </Link>
  );
}
