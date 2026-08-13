'use client';

import { supabaseBrowser } from './supabase/client';
import type { PreparedMedia } from '@/hooks/useUploader';
import type { Post } from './types';

export const FEED_PAGE_SIZE = 12;

const POST_SELECT =
  'id, author, parent_id, root_id, path, depth, body, reply_count, thread_count, like_count, created_at, edited_at, deleted_at, profiles:author (id, slug, display_name, full_name, avatar_path), media (*), post_likes (user_id)';

type RawPost = Omit<Post, 'profiles' | 'media' | 'liked_by_me'> & {
  profiles: Post['profiles'] | Post['profiles'][];
  media: Post['media'];
  post_likes: { user_id: string }[] | null;
};

function shape(row: RawPost, meId: string): Post {
  const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  return {
    ...row,
    profiles: profile ?? null,
    media: row.media ?? [],
    liked_by_me: (row.post_likes ?? []).some((like) => like.user_id === meId),
  };
}

/** Лента корневых постов. Пагинация по курсору created_at — без OFFSET,
 *  поэтому глубина листания не влияет на скорость. */
export async function fetchFeed(meId: string, cursor?: string | null): Promise<Post[]> {
  const supabase = supabaseBrowser();
  let query = supabase
    .from('posts')
    .select(POST_SELECT)
    .is('parent_id', null)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(FEED_PAGE_SIZE);

  if (cursor) query = query.lt('created_at', cursor);

  const { data, error } = await query;
  if (error) throw new Error('Не удалось загрузить ленту');
  return (data as unknown as RawPost[]).map((row) => shape(row, meId));
}

/** Вся ветка одним запросом. Сортировка по path — это обход в глубину,
 *  поэтому дерево собирается за один проход без рекурсивных запросов. */
export async function fetchThread(rootId: string, meId: string): Promise<Post[]> {
  const supabase = supabaseBrowser();
  const { data, error } = await supabase
    .from('posts')
    .select(POST_SELECT)
    .eq('root_id', rootId)
    .order('path', { ascending: true });

  if (error) throw new Error('Не удалось загрузить ветку');
  return (data as unknown as RawPost[]).map((row) => shape(row, meId));
}

export interface NewPost {
  body: string;
  parentId?: string | null;
  media?: PreparedMedia[];
}

export async function createPost({ body, parentId = null, media = [] }: NewPost): Promise<Post> {
  const supabase = supabaseBrowser();
  const { data: auth } = await supabase.auth.getUser();
  const meId = auth.user?.id;
  if (!meId) throw new Error('Сессия истекла. Войдите заново.');

  const { data: post, error } = await supabase
    .from('posts')
    .insert({ body: body.trim() || null, parent_id: parentId, author: meId })
    .select(POST_SELECT)
    .single();

  if (error || !post) throw new Error('Не удалось опубликовать');

  if (media.length > 0) {
    const rows = media.map((item) => ({
      owner: meId,
      bucket: item.bucket,
      path: item.path,
      mime: item.mime,
      kind: item.kind,
      size_bytes: item.size_bytes,
      width: item.width,
      height: item.height,
      duration_sec: item.duration_sec,
      poster_path: item.poster_path,
      waveform: item.waveform,
      post_id: (post as unknown as Post).id,
    }));

    const { data: inserted } = await supabase.from('media').insert(rows).select('*');
    const shaped = shape(post as unknown as RawPost, meId);
    return { ...shaped, media: (inserted as Post['media']) ?? [] };
  }

  return shape(post as unknown as RawPost, meId);
}

export async function toggleLike(postId: string, liked: boolean): Promise<void> {
  const supabase = supabaseBrowser();
  const { data: auth } = await supabase.auth.getUser();
  const meId = auth.user?.id;
  if (!meId) return;

  if (liked) {
    await supabase.from('post_likes').delete().eq('post_id', postId).eq('user_id', meId);
  } else {
    await supabase.from('post_likes').insert({ post_id: postId, user_id: meId });
  }
}

export async function softDeletePost(postId: string): Promise<void> {
  const supabase = supabaseBrowser();
  await supabase.from('posts').update({ deleted_at: new Date().toISOString() }).eq('id', postId);
}

/** Плоский список из БД → дерево. Дети уже идут в правильном порядке. */
export interface PostNode extends Post {
  children: PostNode[];
}

export function buildTree(posts: Post[], rootId: string): PostNode | null {
  const map = new Map<string, PostNode>();
  posts.forEach((post) => map.set(post.id, { ...post, children: [] }));

  let root: PostNode | null = null;
  map.forEach((node) => {
    if (node.id === rootId) {
      root = node;
      return;
    }
    const parent = node.parent_id ? map.get(node.parent_id) : null;
    if (parent) parent.children.push(node);
  });

  return root;
}
