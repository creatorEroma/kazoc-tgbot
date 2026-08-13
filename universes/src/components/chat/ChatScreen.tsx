'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { formatDayLabel } from '@/lib/format';
import MessageBubble from './MessageBubble';
import ChatComposer from './ChatComposer';
import type { Message, Profile } from '@/lib/types';

interface Props {
  me: Profile;
}

const PAGE = 40;

export default function ChatScreen({ me }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (before?: string) => {
      const supabase = supabaseBrowser();
      let query = supabase
        .from('messages')
        .select('*, media (*)')
        .order('created_at', { ascending: false })
        .limit(PAGE);

      if (before) query = query.lt('created_at', before);

      const { data } = await query;
      const page = ((data ?? []) as Message[]).reverse();

      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        return [...page.filter((m) => !seen.has(m.id)), ...prev];
      });
      if (page.length < PAGE) setHasMore(false);
      setLoading(false);
      return page;
    },
    [],
  );

  useEffect(() => {
    void load().then(() => {
      requestAnimationFrame(() => bottom.current?.scrollIntoView());
    });
  }, [load]);

  // Помечаем прочитанным всё, что написал второй.
  useEffect(() => {
    const unread = messages.filter((m) => m.author !== me.id && !m.read_at);
    if (unread.length === 0) return;

    const supabase = supabaseBrowser();
    void supabase
      .from('messages')
      .update({ read_at: new Date().toISOString() })
      .in(
        'id',
        unread.map((m) => m.id),
      );
  }, [me.id, messages]);

  // Realtime: новые сообщения, правки и удаления прилетают сами.
  useEffect(() => {
    const supabase = supabaseBrowser();
    const channel = supabase
      .channel('chat')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async (payload) => {
        const row = payload.new as Message;
        if (row.author === me.id) return;

        const { data } = await supabase.from('messages').select('*, media (*)').eq('id', row.id).single();
        setMessages((prev) =>
          prev.some((m) => m.id === row.id) ? prev : [...prev, (data as Message) ?? row],
        );
        requestAnimationFrame(() => bottom.current?.scrollIntoView({ behavior: 'smooth' }));
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, (payload) => {
        const row = payload.new as Message;
        setMessages((prev) => prev.map((m) => (m.id === row.id ? { ...m, ...row } : m)));
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [me.id]);

  // Подгрузка истории вверх с сохранением позиции прокрутки.
  async function loadOlder() {
    const node = scroller.current;
    const before = messages[0]?.created_at;
    if (!node || !before) return;

    const previousHeight = node.scrollHeight;
    await load(before);
    requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight - previousHeight;
    });
  }

  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);

  const groups = useMemo(() => {
    const result: { day: string; items: Message[] }[] = [];
    messages.forEach((message) => {
      const day = formatDayLabel(message.created_at);
      const last = result[result.length - 1];
      if (last && last.day === day) last.items.push(message);
      else result.push({ day, items: [message] });
    });
    return result;
  }, [messages]);

  return (
    <div className="flex h-[calc(100dvh-61px)] flex-col">
      <div ref={scroller} className="flex-1 overflow-y-auto px-3 py-4">
        <div className="mx-auto max-w-2xl space-y-3">
          {hasMore && !loading && messages.length > 0 && (
            <div className="text-center">
              <button type="button" className="btn-ghost text-[13px]" onClick={loadOlder}>
                Показать раньше
              </button>
            </div>
          )}

          {loading && (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className={`flex ${i % 2 ? 'justify-end' : ''}`}>
                  <div className="skeleton h-12 w-2/3 rounded-card" />
                </div>
              ))}
            </div>
          )}

          {!loading && messages.length === 0 && (
            <p className="py-20 text-center text-[14px] text-muted">
              Здесь пока тихо. Напишите первое слово ♥
            </p>
          )}

          {groups.map((group) => (
            <div key={group.day} className="space-y-2.5">
              <p className="sticky top-0 z-10 mx-auto w-fit rounded-full bg-raised/90 px-3 py-1 text-[12px] text-muted backdrop-blur">
                {group.day}
              </p>

              {group.items.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  mine={message.author === me.id}
                  replyTo={message.reply_to ? byId.get(message.reply_to) : null}
                  onReply={setReplyTo}
                  onEdited={(updated) =>
                    setMessages((prev) => prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m)))
                  }
                  onDeleted={(id) =>
                    setMessages((prev) =>
                      prev.map((m) =>
                        m.id === id ? { ...m, deleted_at: new Date().toISOString() } : m,
                      ),
                    )
                  }
                />
              ))}
            </div>
          ))}

          <div ref={bottom} />
        </div>
      </div>

      <ChatComposer
        me={me}
        replyTo={replyTo}
        onClearReply={() => setReplyTo(null)}
        onSent={(message) => {
          setMessages((prev) => [...prev, message]);
          requestAnimationFrame(() => bottom.current?.scrollIntoView({ behavior: 'smooth' }));
        }}
      />
    </div>
  );
}
