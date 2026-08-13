'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import PostCard from './PostCard';
import PostComposer from './PostComposer';
import CommentBranch from './CommentBranch';
import { buildTree, fetchThread } from '@/lib/queries';
import { supabaseBrowser } from '@/lib/supabase/client';
import { withCount } from '@/lib/format';
import type { Post, Profile } from '@/lib/types';

interface Props {
  rootId: string;
  me: Profile;
}

export default function ThreadView({ rootId, me }: Props) {
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setPosts(await fetchThread(rootId, me.id));
    } catch {
      setError('Не удалось открыть ветку');
    }
  }, [me.id, rootId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Ответ собеседника прилетает в открытую ветку сам.
  useEffect(() => {
    const supabase = supabaseBrowser();
    const channel = supabase
      .channel(`thread-${rootId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'posts', filter: `root_id=eq.${rootId}` },
        (payload) => {
          const row = payload.new as Post;
          if (row.author === me.id) return;
          void load();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load, me.id, rootId]);

  const tree = useMemo(() => (posts ? buildTree(posts, rootId) : null), [posts, rootId]);

  const addReply = useCallback((parentId: string, post: Post) => {
    setPosts((prev) => (prev ? [...prev, { ...post, parent_id: parentId }] : [post]));
  }, []);

  const removePost = useCallback((id: string) => {
    setPosts((prev) => prev?.filter((p) => p.id !== id && !p.path.includes(id)) ?? null);
  }, []);

  if (error) {
    return (
      <div className="py-16 text-center">
        <p className="mb-3 text-[14px] text-rose">{error}</p>
        <button type="button" className="btn-ghost" onClick={() => void load()}>
          Обновить
        </button>
      </div>
    );
  }

  if (!posts || !tree) {
    return (
      <div className="card space-y-3 p-5">
        <div className="skeleton h-4 w-40" />
        <div className="skeleton h-3 w-full" />
        <div className="skeleton h-3 w-3/4" />
      </div>
    );
  }

  const replies = posts.length - 1;

  return (
    <div className="space-y-4">
      <PostCard post={tree} me={me} linkToThread={false} onDeleted={removePost} />

      <PostComposer
        me={me}
        parentId={tree.id}
        placeholder="Ответить в ветке"
        submitLabel="Ответить"
        onCreated={(post) => addReply(tree.id, post)}
      />

      <p className="px-1 text-[13px] text-muted">
        {replies > 0 ? withCount(replies, 'ответ', 'ответа', 'ответов') : 'Ответов пока нет'}
      </p>

      <div className="space-y-1">
        {tree.children.map((child) => (
          <CommentBranch
            key={child.id}
            node={child}
            me={me}
            onReplyCreated={addReply}
            onDeleted={removePost}
          />
        ))}
      </div>
    </div>
  );
}
