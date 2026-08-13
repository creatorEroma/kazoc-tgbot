'use client';

import { useRef, useState } from 'react';
import { useUploader } from '@/hooks/useUploader';
import { createPost } from '@/lib/queries';
import { storagePath } from '@/lib/media';
import { uploadResumable } from '@/lib/upload';
import MediaPicker from '@/components/media/MediaPicker';
import VoiceRecorder, { type RecordedVoice } from '@/components/media/VoiceRecorder';
import type { Post, Profile } from '@/lib/types';

interface Props {
  me: Profile;
  parentId?: string | null;
  placeholder?: string;
  submitLabel?: string;
  autoFocus?: boolean;
  onCreated: (post: Post) => void;
  onCancel?: () => void;
}

export default function PostComposer({
  me,
  parentId = null,
  placeholder = 'Что на душе?',
  submitLabel = 'Опубликовать',
  autoFocus = false,
  onCreated,
  onCancel,
}: Props) {
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [voice, setVoice] = useState<RecordedVoice | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const uploader = useUploader({ userSlug: me.slug });
  // Пока файл не долетел, отправлять нельзя — иначе пост уйдёт без вложения.
  const canSend =
    (body.trim().length > 0 || uploader.tasks.length > 0 || voice) && !sending && !uploader.busy;

  function autoGrow(el: HTMLTextAreaElement) {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }

  async function submit() {
    if (!canSend) return;
    setSending(true);
    setError(null);

    try {
      const media = uploader.collect();

      // Голосовое кладём в отдельный бакет — у него свои mime и политики.
      if (voice) {
        const path = storagePath(me.slug, `golos-${Date.now()}.webm`);
        await uploadResumable({
          file: voice.blob,
          bucket: 'voice',
          path,
          contentType: voice.mime,
        }).promise;

        media.push({
          bucket: 'voice',
          path,
          mime: voice.mime,
          kind: 'audio',
          size_bytes: voice.blob.size,
          width: null,
          height: null,
          duration_sec: voice.duration,
          poster_path: null,
          waveform: voice.waveform,
        });
      }

      const post = await createPost({ body, parentId, media });
      onCreated({ ...post, profiles: me });

      setBody('');
      setVoice(null);
      uploader.reset();
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не получилось отправить');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="card p-4">
      <textarea
        ref={textareaRef}
        value={body}
        autoFocus={autoFocus}
        onChange={(e) => {
          setBody(e.target.value);
          autoGrow(e.target);
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void submit();
        }}
        placeholder={placeholder}
        rows={parentId ? 2 : 3}
        className="w-full resize-none border-0 bg-transparent text-[15.5px] leading-relaxed text-ink outline-none placeholder:text-muted/70"
      />

      {voice && (
        <div className="mt-2 flex items-center gap-2 rounded-soft bg-raised/70 px-3 py-2 text-[13px] text-muted">
          <span className="text-rose">●</span>
          Голосовое записано
          <button type="button" className="btn-quiet ml-auto px-2 py-1" onClick={() => setVoice(null)}>
            Убрать
          </button>
        </div>
      )}

      <div className="mt-2">
        <MediaPicker
          tasks={uploader.tasks}
          onAdd={uploader.add}
          onRemove={uploader.remove}
          totalBytes={uploader.totalBytes}
          uploadedBytes={uploader.uploadedBytes}
        />
      </div>

      {error && <p className="mt-2 text-[13px] text-rose">{error}</p>}

      <div className="mt-3 flex items-center gap-2">
        {recording ? (
          <VoiceRecorder
            onRecorded={(value) => {
              setVoice(value);
              setRecording(false);
            }}
            onCancel={() => setRecording(false)}
          />
        ) : (
          <>
            {!voice && (
              <button
                type="button"
                className="btn-quiet px-3"
                onClick={() => setRecording(true)}
              >
                Голосом
              </button>
            )}

            <div className="ml-auto flex items-center gap-2">
              {onCancel && (
                <button type="button" className="btn-quiet" onClick={onCancel}>
                  Отмена
                </button>
              )}
              <button type="button" className="btn-primary" onClick={submit} disabled={!canSend}>
                {sending ? 'Отправляем…' : uploader.busy ? 'Файлы грузятся…' : submitLabel}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
