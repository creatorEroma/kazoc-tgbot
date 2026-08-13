'use client';

import { useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useUploader } from '@/hooks/useUploader';
import { storagePath } from '@/lib/media';
import { uploadResumable } from '@/lib/upload';
import MediaPicker from '@/components/media/MediaPicker';
import VoiceRecorder, { type RecordedVoice } from '@/components/media/VoiceRecorder';
import type { Message, Profile } from '@/lib/types';

interface Props {
  me: Profile;
  replyTo: Message | null;
  onClearReply: () => void;
  onSent: (message: Message) => void;
}

export default function ChatComposer({ me, replyTo, onClearReply, onSent }: Props) {
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const uploader = useUploader({ userSlug: me.slug });

  async function send(voice?: RecordedVoice) {
    const text = body.trim();
    const files = uploader.collect();
    if (!voice && !text && files.length === 0) return;
    if (uploader.busy) return;

    setSending(true);
    setError(null);

    try {
      const supabase = supabaseBrowser();
      const kind = voice ? 'voice' : files.length > 0 ? 'media' : 'text';

      const { data: message, error: insertError } = await supabase
        .from('messages')
        .insert({
          author: me.id,
          body: text || null,
          kind,
          reply_to: replyTo?.id ?? null,
        })
        .select('*')
        .single();

      if (insertError || !message) throw new Error('Сообщение не отправилось');
      const created = message as Message;

      const rows = files.map((item) => ({
        owner: me.id,
        bucket: item.bucket,
        path: item.path,
        mime: item.mime,
        kind: item.kind,
        size_bytes: item.size_bytes,
        width: item.width,
        height: item.height,
        duration_sec: item.duration_sec,
        poster_path: item.poster_path,
        message_id: created.id,
      }));

      if (voice) {
        const path = storagePath(me.slug, `golos-${Date.now()}.webm`);
        await uploadResumable({
          file: voice.blob,
          bucket: 'voice',
          path,
          contentType: voice.mime,
        }).promise;

        rows.push({
          owner: me.id,
          bucket: 'voice',
          path,
          mime: voice.mime,
          kind: 'audio',
          size_bytes: voice.blob.size,
          width: null,
          height: null,
          duration_sec: voice.duration,
          poster_path: null,
          message_id: created.id,
        });
      }

      let media: Message['media'] = [];
      if (rows.length > 0) {
        const { data: inserted } = await supabase
          .from('media')
          .insert(
            voice
              ? rows.map((row) => (row.bucket === 'voice' ? { ...row, waveform: voice.waveform } : row))
              : rows,
          )
          .select('*');
        media = (inserted as Message['media']) ?? [];
      }

      onSent({ ...created, media });
      setBody('');
      uploader.reset();
      setShowFiles(false);
      onClearReply();
      if (inputRef.current) inputRef.current.style.height = 'auto';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не отправилось');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="border-t border-line bg-surface/95 px-3 py-2.5 backdrop-blur">
      <div className="mx-auto max-w-2xl">
        {replyTo && (
          <div className="mb-2 flex items-center gap-2 rounded-soft border-l-2 border-rose bg-raised/60 px-3 py-1.5 text-[13px]">
            <span className="min-w-0 flex-1 truncate text-muted">
              Ответ: {replyTo.body ?? (replyTo.kind === 'voice' ? 'голосовое' : 'вложение')}
            </span>
            <button type="button" className="btn-quiet px-1.5 py-0.5" onClick={onClearReply}>
              ×
            </button>
          </div>
        )}

        {showFiles && (
          <div className="mb-2">
            <MediaPicker
              tasks={uploader.tasks}
              onAdd={uploader.add}
              onRemove={uploader.remove}
              totalBytes={uploader.totalBytes}
              uploadedBytes={uploader.uploadedBytes}
            />
          </div>
        )}

        {error && <p className="mb-1.5 text-[13px] text-rose">{error}</p>}

        {recording ? (
          <VoiceRecorder
            onRecorded={(voice) => {
              setRecording(false);
              void send(voice);
            }}
            onCancel={() => setRecording(false)}
          />
        ) : (
          <div className="flex items-end gap-1.5">
            <button
              type="button"
              onClick={() => setShowFiles((v) => !v)}
              aria-label="Прикрепить файл"
              className="flex h-10 w-10 flex-none items-center justify-center rounded-full text-lg text-muted transition hover:bg-raised hover:text-ink"
            >
              +
            </button>

            <textarea
              ref={inputRef}
              value={body}
              rows={1}
              placeholder="Сообщение"
              className="max-h-32 flex-1 resize-none rounded-soft border border-line bg-bg px-3.5 py-2.5 text-[15px] text-ink outline-none transition focus:border-rose/60"
              onChange={(e) => {
                setBody(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = `${Math.min(e.target.scrollHeight, 128)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />

            {body.trim() || uploader.tasks.length > 0 ? (
              <button
                type="button"
                onClick={() => void send()}
                disabled={sending || uploader.busy}
                aria-label="Отправить"
                className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-rose text-surface transition disabled:opacity-50"
              >
                ↑
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setRecording(true)}
                aria-label="Записать голосовое"
                className="flex h-10 w-10 flex-none items-center justify-center rounded-full text-muted transition hover:bg-raised hover:text-ink"
              >
                ●
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
