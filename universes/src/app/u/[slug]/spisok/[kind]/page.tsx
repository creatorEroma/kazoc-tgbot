import { notFound, redirect } from 'next/navigation';
import PageHeader from '@/components/ui/PageHeader';
import BoardScreen from '@/components/board/BoardScreen';
import { BOARD_KINDS, KIND_BY_PATH, UNIVERSES, isUniverse } from '@/lib/constants';
import { currentProfile } from '@/lib/supabase/server';
import type { Profile } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function PersonalBoardPage({
  params,
}: {
  params: Promise<{ slug: string; kind: string }>;
}) {
  const { slug, kind: kindPath } = await params;
  const kind = KIND_BY_PATH[kindPath];
  if (!isUniverse(slug) || !kind) notFound();

  const me = await currentProfile();
  if (!me) redirect('/vhod');

  const meta = BOARD_KINDS[kind];
  const universe = UNIVERSES[slug];

  return (
    <main className="min-h-dvh pb-20">
      <PageHeader
        title={meta.title}
        subtitle={`Личное · ${universe.name}`}
        backHref={`/u/${slug}`}
        backLabel={universe.name}
      />
      <div className="mx-auto max-w-3xl px-4 py-5">
        <BoardScreen kind={kind} scope="personal" universe={slug} me={me as Profile} />
      </div>
    </main>
  );
}
