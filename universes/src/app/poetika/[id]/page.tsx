import { redirect } from 'next/navigation';
import PageHeader from '@/components/ui/PageHeader';
import ThreadView from '@/components/feed/ThreadView';
import { currentProfile } from '@/lib/supabase/server';
import type { Profile } from '@/lib/types';

export const metadata = { title: 'Ветка — Поэтика' };
export const dynamic = 'force-dynamic';

export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await currentProfile();
  if (!me) redirect('/vhod');

  return (
    <main className="min-h-dvh pb-20">
      <PageHeader title="Ветка" backHref="/poetika" backLabel="Поэтика" />
      <div className="mx-auto max-w-2xl px-4 py-5">
        <ThreadView rootId={id} me={me as Profile} />
      </div>
    </main>
  );
}
