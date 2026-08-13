import { redirect } from 'next/navigation';
import PageHeader from '@/components/ui/PageHeader';
import ThreadFeed from '@/components/feed/ThreadFeed';
import { currentProfile, supabaseServer } from '@/lib/supabase/server';
import { FEED_PAGE_SIZE } from '@/lib/queries';
import type { Post, Profile } from '@/lib/types';

export const metadata = { title: 'Поэтика' };
export const dynamic = 'force-dynamic';

export default async function PoetikaPage() {
  const me = await currentProfile();
  if (!me) redirect('/vhod');

  const supabase = await supabaseServer();
  const { data } = await supabase
    .from('posts')
    .select(
      'id, author, parent_id, root_id, path, depth, body, reply_count, thread_count, like_count, created_at, edited_at, deleted_at, profiles:author (id, slug, display_name, full_name, avatar_path), media (*), post_likes (user_id)',
    )
    .is('parent_id', null)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(FEED_PAGE_SIZE);

  const initial: Post[] = (data ?? []).map((row) => {
    const raw = row as unknown as Post & { post_likes?: { user_id: string }[] };
    const profile = Array.isArray(raw.profiles) ? raw.profiles[0] : raw.profiles;
    return {
      ...raw,
      profiles: profile ?? null,
      media: raw.media ?? [],
      liked_by_me: (raw.post_likes ?? []).some((like) => like.user_id === me.id),
    };
  });

  return (
    <main className="min-h-dvh pb-20">
      <PageHeader title="Поэтика" subtitle="Стихи, мысли и всё, что хочется сказать" />
      <div className="mx-auto max-w-2xl px-4 py-5">
        <ThreadFeed me={me as Profile} initial={initial} />
      </div>
    </main>
  );
}
