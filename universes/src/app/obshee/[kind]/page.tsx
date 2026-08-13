import { notFound, redirect } from 'next/navigation';
import PageHeader from '@/components/ui/PageHeader';
import BoardScreen from '@/components/board/BoardScreen';
import { BOARD_KINDS, KIND_BY_PATH } from '@/lib/constants';
import { currentProfile } from '@/lib/supabase/server';
import type { Profile } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function SharedBoardPage({
  params,
}: {
  params: Promise<{ kind: string }>;
}) {
  const { kind: kindPath } = await params;
  const kind = KIND_BY_PATH[kindPath];
  if (!kind) notFound();

  const me = await currentProfile();
  if (!me) redirect('/vhod');

  const meta = BOARD_KINDS[kind];

  return (
    <main className="min-h-dvh pb-20">
      <PageHeader title={meta.title} subtitle="Общее — видно обоим сразу" />
      <div className="mx-auto max-w-3xl px-4 py-5">
        <BoardScreen kind={kind} scope="shared" universe={me.slug} me={me as Profile} />
      </div>
    </main>
  );
}
