'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useSignedUrl } from '@/lib/media';
import { formatDate, formatPrice } from '@/lib/format';
import {
  BOARD_KINDS,
  PATH_BY_KIND,
  PRIORITY_LABELS,
  STATUS_LABELS,
  type BoardKind,
  type UniverseSlug,
} from '@/lib/constants';
import BoardItemForm from './BoardItemForm';
import type { BoardItem, Profile } from '@/lib/types';

interface Props {
  kind: BoardKind;
  scope: 'personal' | 'shared';
  universe: UniverseSlug;
  me: Profile;
}

const NEXT_STATUS: Record<BoardItem['status'], BoardItem['status']> = {
  idea: 'in_progress',
  in_progress: 'done',
  done: 'idea',
};

export default function BoardScreen({ kind, scope, universe, me }: Props) {
  const [items, setItems] = useState<BoardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<BoardItem | null>(null);

  const load = useCallback(async () => {
    const supabase = supabaseBrowser();
    let query = supabase
      .from('board_items')
      .select('*')
      .eq('kind', kind)
      .eq('scope', scope)
      .order('status')
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false });

    // В личном разделе показываем только вселенную владельца,
    // общее — обе: там записи обоих лежат вперемешку.
    if (scope === 'personal') query = query.eq('universe', universe);

    const { data } = await query;
    setItems((data ?? []) as BoardItem[]);
    setLoading(false);
  }, [kind, scope, universe]);

  useEffect(() => {
    void load();
  }, [load]);

  // Общее обновляется у обоих мгновенно: добавила она — увидел он.
  useEffect(() => {
    if (scope !== 'shared') return;
    const supabase = supabaseBrowser();
    const channel = supabase
      .channel(`board-${kind}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'board_items' }, () => void load())
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [kind, load, scope]);

  async function cycleStatus(item: BoardItem) {
    const status = NEXT_STATUS[item.status];
    setItems((prev) => prev.map((row) => (row.id === item.id ? { ...row, status } : row)));
    const supabase = supabaseBrowser();
    await supabase.from('board_items').update({ status }).eq('id', item.id);
  }

  async function remove(item: BoardItem) {
    if (!confirm(`Удалить «${item.title}»?`)) return;
    setItems((prev) => prev.filter((row) => row.id !== item.id));
    const supabase = supabaseBrowser();
    await supabase.from('board_items').delete().eq('id', item.id);
  }

  const meta = BOARD_KINDS[kind];
  const otherHref =
    scope === 'personal' ? `/obshee/${PATH_BY_KIND[kind]}` : `/u/${me.slug}/spisok/${PATH_BY_KIND[kind]}`;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-full border border-line bg-surface p-0.5 text-[13px]">
          <Tab active={scope === 'personal'} href={`/u/${me.slug}/spisok/${PATH_BY_KIND[kind]}`}>
            Личное
          </Tab>
          <Tab active={scope === 'shared'} href={`/obshee/${PATH_BY_KIND[kind]}`}>
            Общее
          </Tab>
        </div>

        <button type="button" className="btn-primary ml-auto" onClick={() => setAdding(true)}>
          + {meta.single}
        </button>
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-28" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="font-display text-[18px] text-ink">
            {scope === 'shared' ? 'Общий список пуст' : 'Пока ничего нет'}
          </p>
          <p className="mx-auto mt-2 max-w-sm text-[14px] text-muted">
            {scope === 'shared'
              ? 'Всё, что вы сюда добавите, сразу увидит второй — и наоборот.'
              : `${meta.hint}. Это видите только вы.`}
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <button type="button" className="btn-primary" onClick={() => setAdding(true)}>
              Добавить
            </button>
            <Link href={otherHref} className="btn-ghost">
              {scope === 'personal' ? 'Открыть общее' : 'Открыть личное'}
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              mine={item.owner === me.id}
              onEdit={() => setEditing(item)}
              onDelete={() => remove(item)}
              onStatus={() => cycleStatus(item)}
            />
          ))}
        </div>
      )}

      {(adding || editing) && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 backdrop-blur-sm sm:items-center sm:p-6"
          onClick={() => {
            setAdding(false);
            setEditing(null);
          }}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="max-h-[92dvh] w-full max-w-lg animate-fade-up overflow-y-auto rounded-t-card border border-line bg-surface p-5 shadow-lift sm:rounded-card"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 font-display text-[20px] text-ink">
              {editing ? 'Редактирование' : meta.single}
            </h2>
            <BoardItemForm
              kind={kind}
              scope={scope}
              universe={scope === 'shared' ? me.slug : universe}
              userSlug={me.slug}
              initial={editing}
              onSaved={(saved) => {
                setItems((prev) => {
                  const exists = prev.some((row) => row.id === saved.id);
                  return exists
                    ? prev.map((row) => (row.id === saved.id ? saved : row))
                    : [saved, ...prev];
                });
                setAdding(false);
                setEditing(null);
              }}
              onCancel={() => {
                setAdding(false);
                setEditing(null);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function Tab({ active, href, children }: { active: boolean; href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`rounded-full px-3.5 py-1.5 font-medium transition ${
        active ? 'bg-rose text-surface' : 'text-muted hover:text-ink'
      }`}
    >
      {children}
    </Link>
  );
}

function ItemCard({
  item,
  mine,
  onEdit,
  onDelete,
  onStatus,
}: {
  item: BoardItem;
  mine: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onStatus: () => void;
}) {
  const cover = useSignedUrl('media', item.cover_path);
  const statusStyle =
    item.status === 'done'
      ? 'bg-sage/15 text-sage'
      : item.status === 'in_progress'
        ? 'bg-rose/15 text-rose'
        : 'bg-raised text-muted';

  return (
    <article className={`card overflow-hidden ${item.status === 'done' ? 'opacity-75' : ''}`}>
      {cover && <img src={cover} alt="" className="h-36 w-full object-cover" loading="lazy" />}

      <div className="p-4">
        <div className="flex items-start gap-2">
          <h3
            className={`flex-1 font-display text-[17px] leading-snug text-ink ${
              item.status === 'done' ? 'line-through decoration-muted/50' : ''
            }`}
          >
            {item.title}
          </h3>
          <button type="button" onClick={onStatus} className={`chip flex-none ${statusStyle}`}>
            {STATUS_LABELS[item.status]}
          </button>
        </div>

        {item.description && (
          <p className="mt-1.5 whitespace-pre-wrap text-[14px] leading-relaxed text-muted">
            {item.description}
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[12px]">
          {item.price !== null && (
            <span className="chip text-ink">{formatPrice(item.price, item.currency)}</span>
          )}
          {item.priority === 3 && <span className="chip text-rose">{PRIORITY_LABELS[3]}</span>}
          {item.due_date && <span className="chip">до {formatDate(item.due_date)}</span>}
          {item.link && (
            <a
              href={item.link}
              target="_blank"
              rel="noreferrer noopener"
              className="chip text-rose hover:bg-rose/10"
            >
              Ссылка ↗
            </a>
          )}
        </div>

        <div className="mt-3 flex gap-1">
          <button type="button" className="btn-quiet px-2 py-1 text-[12.5px]" onClick={onEdit}>
            Изменить
          </button>
          {mine && (
            <button type="button" className="btn-quiet px-2 py-1 text-[12.5px]" onClick={onDelete}>
              Удалить
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
