'use client';

import { useRef, useState } from 'react';
import { formatBytes, withCount } from '@/lib/format';
import type { UploadTask } from '@/lib/types';

interface Props {
  tasks: UploadTask[];
  onAdd: (files: File[]) => void;
  onRemove: (id: string) => void;
  totalBytes: number;
  uploadedBytes: number;
  label?: string;
  accept?: string;
}

/** Выбор и загрузка тяжёлых файлов: превью появляется сразу, прогресс — в
 *  процентах и мегабайтах, любую загрузку можно отменить. */
export default function MediaPicker({
  tasks,
  onAdd,
  onRemove,
  totalBytes,
  uploadedBytes,
  label = 'Фото или видео',
  accept = 'image/*,video/*',
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    onAdd(Array.from(list));
  }

  const busy = tasks.some((t) => t.status === 'uploading' || t.status === 'waiting');

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={`rounded-soft border border-dashed p-3 transition ${
          dragging ? 'border-rose bg-rose/5' : 'border-line'
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-ghost" onClick={() => inputRef.current?.click()}>
            {label}
          </button>
          <span className="text-[13px] text-muted">
            {dragging ? 'Отпустите — загрузим' : 'или перетащите файлы сюда, вес не ограничен'}
          </span>
        </div>

        <input
          ref={inputRef}
          type="file"
          multiple
          accept={accept}
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = '';
          }}
        />

        {tasks.length > 0 && (
          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {tasks.map((task) => (
              <TaskTile key={task.id} task={task} onRemove={onRemove} />
            ))}
          </div>
        )}
      </div>

      {tasks.length > 0 && (
        <p className="mt-2 text-[12.5px] text-muted">
          {busy
            ? `Загружено ${formatBytes(uploadedBytes)} из ${formatBytes(totalBytes)}`
            : `${withCount(tasks.length, 'файл', 'файла', 'файлов')} готово — ${formatBytes(totalBytes)}`}
        </p>
      )}
    </div>
  );
}

function TaskTile({ task, onRemove }: { task: UploadTask; onRemove: (id: string) => void }) {
  const isImage = task.file.type.startsWith('image/');
  const isVideo = task.file.type.startsWith('video/');

  return (
    <div className="group relative aspect-square overflow-hidden rounded-soft border border-line bg-raised">
      {task.previewUrl && isImage && (
        <img src={task.previewUrl} alt="" className="h-full w-full object-cover" />
      )}
      {task.previewUrl && isVideo && (
        <video src={task.previewUrl} className="h-full w-full object-cover" muted playsInline />
      )}
      {!task.previewUrl && (
        <div className="flex h-full items-center justify-center px-2 text-center text-[11px] text-muted">
          {task.name}
        </div>
      )}

      {task.status !== 'done' && (
        <div className="absolute inset-0 flex flex-col justify-end bg-ink/45 p-1.5">
          <div className="mb-1 text-center text-[11px] font-semibold text-surface">
            {task.status === 'error' ? 'Ошибка' : `${task.progress}%`}
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-surface/35">
            <div
              className="h-full rounded-full bg-surface transition-[width] duration-200"
              style={{ width: `${task.progress}%` }}
            />
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => onRemove(task.id)}
        aria-label="Убрать файл"
        className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-ink/60 text-surface opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100"
      >
        ×
      </button>

      {task.status === 'error' && task.error && (
        <p className="absolute inset-x-0 bottom-0 bg-rose px-1 py-0.5 text-[10px] leading-tight text-surface">
          {task.error}
        </p>
      )}
    </div>
  );
}
