'use client';

import { useCallback, useRef, useState } from 'react';
import { storagePath } from '@/lib/media';
import { probeMedia } from '@/lib/mediaMeta';
import { uploadResumable } from '@/lib/upload';
import type { UploadTask } from '@/lib/types';

export interface PreparedMedia {
  bucket: string;
  path: string;
  mime: string;
  kind: 'image' | 'video' | 'audio' | 'file';
  size_bytes: number;
  width: number | null;
  height: number | null;
  duration_sec: number | null;
  poster_path: string | null;
  waveform: number[] | null;
  /** Локальный blob-URL: показываем превью, пока файл ещё летит в облако. */
  previewUrl?: string;
}

interface Params {
  userSlug: string;
  bucket?: string;
}

/**
 * Очередь загрузок с честным прогрессом.
 * Файлы уходят в облако сразу при выборе — к моменту отправки поста
 * тяжёлое видео обычно уже там, и публикация ощущается мгновенной.
 */
export function useUploader({ userSlug, bucket = 'media' }: Params) {
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const readyRef = useRef<Map<string, PreparedMedia>>(new Map());

  const patch = useCallback((id: string, changes: Partial<UploadTask>) => {
    setTasks((prev) => prev.map((task) => (task.id === id ? { ...task, ...changes } : task)));
  }, []);

  const add = useCallback(
    async (files: File[]) => {
      const fresh: UploadTask[] = files.map((file) => ({
        id: crypto.randomUUID(),
        file,
        name: file.name,
        size: file.size,
        progress: 0,
        uploaded: 0,
        status: 'waiting',
      }));

      setTasks((prev) => [...prev, ...fresh]);

      await Promise.all(
        fresh.map(async (task) => {
          const probe = await probeMedia(task.file);
          patch(task.id, { status: 'uploading', previewUrl: probe.previewUrl });

          const path = storagePath(userSlug, task.file.name);
          const handle = uploadResumable({
            file: task.file,
            bucket,
            path,
            contentType: task.file.type,
            onProgress: (uploaded, total) => {
              patch(task.id, {
                uploaded,
                progress: total > 0 ? Math.round((uploaded / total) * 100) : 0,
              });
            },
          });

          patch(task.id, { abort: handle.abort });

          try {
            await handle.promise;

            // Постер видео кладём рядом отдельным объектом.
            let posterPath: string | null = null;
            if (probe.poster) {
              posterPath = `${path}.poster.jpg`;
              try {
                await uploadResumable({
                  file: probe.poster,
                  bucket,
                  path: posterPath,
                  contentType: 'image/jpeg',
                }).promise;
              } catch {
                posterPath = null;
              }
            }

            readyRef.current.set(task.id, {
              bucket,
              path,
              mime: task.file.type || 'application/octet-stream',
              kind: probe.kind,
              size_bytes: task.file.size,
              width: probe.width,
              height: probe.height,
              duration_sec: probe.duration,
              poster_path: posterPath,
              waveform: null,
              previewUrl: probe.previewUrl,
            });

            patch(task.id, { status: 'done', progress: 100, uploaded: task.file.size });
          } catch (error) {
            patch(task.id, {
              status: 'error',
              error: error instanceof Error ? error.message : 'Ошибка загрузки',
            });
          }
        }),
      );
    },
    [bucket, patch, userSlug],
  );

  const remove = useCallback((id: string) => {
    setTasks((prev) => {
      const target = prev.find((task) => task.id === id);
      target?.abort?.();
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((task) => task.id !== id);
    });
    readyRef.current.delete(id);
  }, []);

  const reset = useCallback(() => {
    setTasks((prev) => {
      prev.forEach((task) => {
        task.abort?.();
        if (task.previewUrl) URL.revokeObjectURL(task.previewUrl);
      });
      return [];
    });
    readyRef.current.clear();
  }, []);

  /** Готовые файлы в порядке добавления. */
  const collect = useCallback(
    () => tasks.map((task) => readyRef.current.get(task.id)).filter(Boolean) as PreparedMedia[],
    [tasks],
  );

  const busy = tasks.some((task) => task.status === 'uploading' || task.status === 'waiting');
  const totalBytes = tasks.reduce((sum, task) => sum + task.size, 0);
  const uploadedBytes = tasks.reduce((sum, task) => sum + task.uploaded, 0);

  return { tasks, add, remove, reset, collect, busy, totalBytes, uploadedBytes };
}
