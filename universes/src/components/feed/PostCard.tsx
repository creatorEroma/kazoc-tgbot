'use client';

import Link from 'next/link';
import { useState } from 'react';
import Avatar from '@/components/ui/Avatar';
import MediaGrid from '@/components/media/MediaGrid';
import AudioPlayer from '@/components/media/AudioPlayer';
import { formatDateTime, withCount } from '@/lib/format';
import { softDeletePost, toggleLike } from '@/lib/queries';
import type { Post, Profile } from '@/lib/types';

interface Props {
  post: Post;
  me: Profile;
  /** В ленте карточка кликабельна целиком, в ветке — нет. */
  linkToThread?: boolean;
  onReply?: () => void;
  onDeleted?: (id: string) => void;
  compact?: boolean;
}

export default function PostCard({
  post,
  me,
  linkToThread = true,
  onReply,
  onDeleted,
  compact = false,
}: Props) {
  const [liked, setLiked] = useState(Boolean(post.liked_by_me));
  const [likes, setLikes] = useState(post.like_count);
  const [removed, setRemoved] = useState(Boolean(post.deleted_at));

  const author = post.profiles;
  const voices = (post.media ?? []).filter((m) => m.kind === 'audio');
  const visuals = (post.media ?? []).filter((m) => m.kind !== 'audio');
  const mine = post.author === me.id;

  async function onLike() {
    // Оптимистично: сердечко реагирует мгновенно, запрос догоняет.
    setLiked(!liked);
    setLikes((n) => (liked ? Math.max(0, n - 1) : n + 1));
    try {
      await toggleLike(post.id, liked);
    } catch {
      setLiked(liked);
      setLikes(post.like_count);
    }
  }

  async function onDelete() {
    if (!confirm('Удалить запись? Ветка комментариев тоже скроется.')) return;
    setRemoved(true);
    await softDeletePost(post.id);
    onDeleted?.(post.id);
  }

  if (removed) {
    return (
      <article className="px-1 py-3 text-[13px] text-muted">Запись удалена</article>
    );
  }

  return (
    <article className={`animate-fade-up ${compact ? '' : 'card p-4 sm:p-5'}`}>
      <div className="flex items-center gap-2.5">
        <Avatar profile={author} size={compact ? 32 : 38} />
        <div className="min-w-0">
          <p className="truncate text-[14.5px] font-semibold text-ink">
            {author?.display_name ?? 'Кто-то'}
          </p>
          <p className="text-[12px] text-muted">
            {formatDateTime(post.created_at)}
            {post.edited_at && ' · изменено'}
            {post.pending && ' · отправляется…'}
          </p>
        </div>

        {mine && !post.pending && (
          <button type="button" onClick={onDelete} className="btn-quiet ml-auto px-2 py-1 text-[12px]">
            Удалить
          </button>
        )}
      </div>

      {post.body && (
        <p className="mt-2.5 whitespace-pre-wrap break-words text-[15.5px] leading-relaxed text-ink">
          {post.body}
        </p>
      )}

      {visuals.length > 0 && <MediaGrid items={visuals} />}

      {voices.map((voice) => (
        <div key={voice.id} className="mt-2.5 rounded-soft border border-line bg-raised/40 p-2.5">
          <AudioPlayer
            bucket={voice.bucket}
            path={voice.path}
            duration={voice.duration_sec}
            waveform={voice.waveform}
          />
        </div>
      ))}

      <div className="mt-3 flex items-center gap-1 text-[13px]">
        <button
          type="button"
          onClick={onLike}
          className={`btn-quiet px-2.5 py-1 ${liked ? 'text-rose' : ''}`}
          aria-pressed={liked}
        >
          {liked ? '♥' : '♡'} {likes > 0 ? likes : ''}
        </button>

        {onReply && (
          <button type="button" onClick={onReply} className="btn-quiet px-2.5 py-1">
            Ответить
          </button>
        )}

        {linkToThread && (
          <Link href={`/poetika/${post.id}`} className="btn-quiet px-2.5 py-1">
            {post.thread_count > 0
              ? withCount(post.thread_count, 'ответ', 'ответа', 'ответов')
              : 'Ответить в ветке'}
          </Link>
        )}
      </div>
    </article>
  );
}
