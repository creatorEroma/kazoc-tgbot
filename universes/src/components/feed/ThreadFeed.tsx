'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import PostCard from './PostCard';
import PostComposer from './PostComposer';
import { FEED_PAGE_SIZE, fetchFeed } from '@/lib/queries';
import { supabaseBrowser } from '@/lib/supabase/client';
import type { Post, Profile } from '@/lib/types';

interface Props {
  me: Profile;
  initial: Post[];
}

export default function ThreadFeed({ me, initial }: Props) {
  const [posts, setPosts] = useState<Post[]>(initial);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(initial.length < FEED_PAGE_SIZE);
  const [error, setError] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);

  const loadMore = useCallback(async () => {
    if (loadingRef.current || done) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const cursor = posts[posts.length - 1]?.created_at ?? null;
      const next = await fetchFeed(me.id, cursor);
      setPosts((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...next.filter((p) => !seen.has(p.id))];
      });
      if (next.length < FEED_PAGE_SIZE) setDone(true);
    } catch {
      setError('Не удалось подгрузить записи');
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [done, me.id, posts]);

  // Бесконечный скролл: подгружаем заранее, за 600px до конца ленты.
  useEffect(() => {
    const node = sentinel.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { rootMargin: '600px' },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore]);

  // Пост, написанный на другом устройстве, появляется здесь сам.
  useEffect(() => {
    const supabase = supabaseBrowser();
    const channel = supabase
      .channel('feed-roots')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'posts', filter: 'depth=eq.0' },
        async (payload) => {
          const row = payload.new as Post;
          if (row.author === me.id) return;
          const [fresh] = await fetchFeed(me.id, null);
          if (fresh && fresh.id === row.id) {
            setPosts((prev) => (prev.some((p) => p.id === fresh.id) ? prev : [fresh, ...prev]));
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [me.id]);

  return (
    <div className="space-y-3">
      <PostComposer me={me} onCreated={(post) => setPosts((prev) => [post, ...prev])} />

      {posts.length === 0 && (
        <p className="py-16 text-center text-[14px] text-muted">
          Здесь пока пусто. Напишите первое — стихи, мысль или просто «привет».
        </p>
      )}

      {posts.map((post) => (
        <PostCard
          key={post.id}
          post={post}
          me={me}
          onDeleted={(id) => setPosts((prev) => prev.filter((p) => p.id !== id))}
        />
      ))}

      {error && (
        <div className="py-4 text-center">
          <p className="mb-2 text-[13px] text-rose">{error}</p>
          <button type="button" className="btn-ghost" onClick={() => void loadMore()}>
            Попробовать снова
          </button>
        </div>
      )}

      {loading && (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <div key={i} className="card space-y-2 p-5">
              <div className="skeleton h-4 w-32" />
              <div className="skeleton h-3 w-full" />
              <div className="skeleton h-3 w-2/3" />
            </div>
          ))}
        </div>
      )}

      {done && posts.length > 0 && (
        <p className="py-8 text-center text-[13px] text-muted">Это всё, что вы написали ♥</p>
      )}

      <div ref={sentinel} className="h-px" />
    </div>
  );
}
