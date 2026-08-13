'use client';

import { useEffect, useState } from 'react';
import MediaGrid from '@/components/media/MediaGrid';
import AudioPlayer from '@/components/media/AudioPlayer';
import { supabaseBrowser } from '@/lib/supabase/client';
import { editWindowLeft, formatDateTime, formatEditLeft } from '@/lib/format';
import type { Message } from '@/lib/types';

interface Props {
  message: Message;
  mine: boolean;
  replyTo?: Message | null;
  onReply: (message: Message) => void;
  onEdited: (message: Message) => void;
  onDeleted: (id: string) => void;
}

/**
 * Пузырь сообщения.
 * Правило 30 минут: кнопка «Изменить» живёт ровно полчаса и исчезает сама,
 * без перезагрузки страницы. Даже если её вернуть через инструменты
 * разработчика, база отклонит UPDATE — правило продублировано триггером.
 */
export default function MessageBubble({
  message,
  mine,
  replyTo,
  onReply,
  onEdited,
  onDeleted,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.body ?? '');
  const [left, setLeft] = useState(() => editWindowLeft(message.created_at));
  const [error, setError] = useState<string | null>(null);

  const canEdit = mine && left > 0 && !message.deleted_at;

  useEffect(() => {
    if (!mine || left <= 0) return;
    const timer = setInterval(() => setLeft(editWindowLeft(message.created_at)), 15000);
    return () => clearInterval(timer);
  }, [left, message.created_at, mine]);

  async function saveEdit() {
    const text = draft.trim();
    if (!text || text === message.body) {
      setEditing(false);
      return;
    }

    const supabase = supabaseBrowser();
    const { data, error: updateError } = await supabase
      .from('messages')
      .update({ body: text })
      .eq('id', message.id)
      .select('*')
      .single();

    if (updateError || !data) {
      setError('Время редактирования вышло — 30 минут уже прошло.');
      setLeft(0);
      return;
    }

    onEdited(data as Message);
    setEditing(false);
  }

  async function remove() {
    if (!confirm('Удалить сообщение?')) return;
    const supabase = supabaseBrowser();
    await supabase.from('messages').update({ deleted_at: new Date().toISOString() }).eq('id', message.id);
    onDeleted(message.id);
  }

  const voices = (message.media ?? []).filter((m) => m.kind === 'audio');
  const visuals = (message.media ?? []).filter((m) => m.kind !== 'audio');

  if (message.deleted_at) {
    return (
      <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
        <p className="rounded-card border border-dashed border-line px-3 py-1.5 text-[13px] text-muted">
          Сообщение удалено
        </p>
      </div>
    );
  }

  return (
    <div className={`group flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] sm:max-w-[70%] ${mine ? 'items-end' : 'items-start'}`}>
        <div
          className={`rounded-card px-3.5 py-2.5 ${
            mine ? 'bg-rose/15 text-ink' : 'border border-line bg-surface text-ink'
          }`}
        >
          {replyTo && (
            <p className="mb-1.5 border-l-2 border-rose/60 pl-2 text-[12.5px] text-muted">
              {replyTo.body ?? (replyTo.kind === 'voice' ? 'голосовое' : 'вложение')}
            </p>
          )}

          {editing ? (
            <div className="min-w-[220px]">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="field min-h-[64px] resize-y bg-surface"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void saveEdit();
                  }
                  if (e.key === 'Escape') setEditing(false);
                }}
              />
              <div className="mt-2 flex justify-end gap-1.5">
                <button type="button" className="btn-quiet px-2 py-1 text-[12.5px]" onClick={() => setEditing(false)}>
                  Отмена
                </button>
                <button type="button" className="btn-primary px-3 py-1 text-[12.5px]" onClick={saveEdit}>
                  Сохранить
                </button>
              </div>
            </div>
          ) : (
            <>
              {message.body && (
                <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">
                  {message.body}
                </p>
              )}

              {visuals.length > 0 && <MediaGrid items={visuals} />}

              {voices.map((voice) => (
                <div key={voice.id} className="mt-1 min-w-[220px]">
                  <AudioPlayer
                    bucket={voice.bucket}
                    path={voice.path}
                    duration={voice.duration_sec}
                    waveform={voice.waveform}
                    incoming={!mine}
                  />
                </div>
              ))}
            </>
          )}

          <div className="mt-1 flex items-center justify-end gap-1.5 text-[11.5px] text-muted">
            {message.edited_at && <span>изменено</span>}
            <span>{formatDateTime(message.created_at)}</span>
            {mine && !message.pending && <span>{message.read_at ? '✓✓' : '✓'}</span>}
            {message.pending && <span>отправляется…</span>}
          </div>
        </div>

        {error && <p className="mt-1 text-right text-[12px] text-rose">{error}</p>}

        <div
          className={`mt-1 flex gap-1 text-[12px] opacity-0 transition group-hover:opacity-100 focus-within:opacity-100 ${
            mine ? 'justify-end' : 'justify-start'
          }`}
        >
          <button type="button" className="btn-quiet px-2 py-0.5" onClick={() => onReply(message)}>
            Ответить
          </button>

          {canEdit && !editing && (
            <button
              type="button"
              className="btn-quiet px-2 py-0.5"
              onClick={() => {
                setDraft(message.body ?? '');
                setEditing(true);
              }}
              title={`Изменить можно ещё ${formatEditLeft(left)}`}
            >
              Изменить
            </button>
          )}

          {mine && (
            <button type="button" className="btn-quiet px-2 py-0.5" onClick={remove}>
              Удалить
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
