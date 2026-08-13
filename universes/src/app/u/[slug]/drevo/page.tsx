import { notFound, redirect } from 'next/navigation';
import PageHeader from '@/components/ui/PageHeader';
import RelativesBoard from '@/components/tree/RelativesBoard';
import { UNIVERSES, isUniverse } from '@/lib/constants';
import { currentProfile } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function TreePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isUniverse(slug)) notFound();

  const me = await currentProfile();
  if (!me) redirect('/vhod');

  const universe = UNIVERSES[slug];

  return (
    <main className="min-h-dvh pb-20">
      <PageHeader
        title="Генеалогическое древо"
        subtitle={`Родные ${universe.possessive} · редактируют оба`}
        backHref={`/u/${slug}`}
        backLabel={universe.name}
      />
      <div className="mx-auto max-w-3xl px-4 py-5">
        <RelativesBoard universe={slug} userSlug={me.slug} />
      </div>
    </main>
  );
}
