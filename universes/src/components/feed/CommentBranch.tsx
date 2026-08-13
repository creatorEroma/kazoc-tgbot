'use client';

import { useState } from 'react';
import PostCard from './PostCard';
import PostComposer from './PostComposer';
import { withCount } from '@/lib/format';
import type { PostNode } from '@/lib/queries';
import type { Post, Profile } from '@/lib/types';

interface Props {
  node: PostNode;
  me: Profile;
  onReplyCreated: (parentId: string, post: Post) => void;
  onDeleted: (id: string) => void;
}

/** Одна ветка комментариев. Компонент рекурсивный, поэтому глубина
 *  не ограничена ничем, кроме здравого смысла. Отступ перестаёт расти
 *  после шестого уровня — иначе на телефоне текст сожмётся в столбик. */
export default function CommentBranch({ node, me, onReplyCreated, onDeleted }: Props) {
  const [replying, setReplying] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="relative pl-3 sm:pl-4">
      <span className="absolute inset-y-0 left-0 w-px bg-line" aria-hidden />

      <div className="py-2.5">
        <PostCard
          post={node}
          me={me}
          compact
          linkToThread={false}
          onReply={() => setReplying((v) => !v)}
          onDeleted={onDeleted}
        />
      </div>

      {replying && (
        <div className="pb-3">
          <PostComposer
            me={me}
            parentId={node.id}
            autoFocus
            placeholder="Ваш ответ"
            submitLabel="Ответить"
            onCreated={(post) => {
              onReplyCreated(node.id, post);
              setReplying(false);
            }}
            onCancel={() => setReplying(false)}
          />
        </div>
      )}

      {node.children.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="mb-1 text-[12.5px] text-muted transition hover:text-ink"
          >
            {collapsed
              ? `Показать ${withCount(node.children.length, 'ответ', 'ответа', 'ответов')}`
              : 'Свернуть ветку'}
          </button>

          {!collapsed &&
            node.children.map((child) => (
              <CommentBranch
                key={child.id}
                node={child}
                me={me}
                onReplyCreated={onReplyCreated}
                onDeleted={onDeleted}
              />
            ))}
        </>
      )}
    </div>
  );
}
