'use client';

import * as tus from 'tus-js-client';
import { supabaseBrowser } from './supabase/client';

/** Supabase принимает резюмируемую загрузку только кусками ровно по 6 МБ. */
const CHUNK_SIZE = 6 * 1024 * 1024;

export interface UploadHandle {
  promise: Promise<void>;
  abort: () => void;
}

interface Options {
  file: File | Blob;
  bucket: string;
  path: string;
  contentType?: string;
  onProgress?: (uploaded: number, total: number) => void;
}

/**
 * Резюмируемая (TUS) загрузка прямо в Supabase Storage.
 *
 * Почему так, а не обычный POST:
 *  - файл идёт мимо сервера Next.js, поэтому вес не упирается в лимиты функций;
 *  - грузится кусками по 6 МБ, и обрыв связи не убивает всю загрузку — докачка
 *    продолжается с последнего куска;
 *  - есть честный прогресс в байтах, а не «крутилка до посинения».
 */
export function uploadResumable({
  file,
  bucket,
  path,
  contentType,
  onProgress,
}: Options): UploadHandle {
  let upload: tus.Upload | null = null;
  let aborted = false;

  const promise = new Promise<void>((resolve, reject) => {
    (async () => {
      const supabase = supabaseBrowser();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;

      if (!token) {
        reject(new Error('Сессия истекла. Войдите заново.'));
        return;
      }
      if (aborted) {
        reject(new Error('Загрузка отменена'));
        return;
      }

      upload = new tus.Upload(file, {
        endpoint: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/upload/resumable`,
        retryDelays: [0, 1000, 3000, 5000, 10000, 20000],
        chunkSize: CHUNK_SIZE,
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        headers: {
          authorization: `Bearer ${token}`,
          'x-upsert': 'true',
        },
        metadata: {
          bucketName: bucket,
          objectName: path,
          contentType: contentType ?? (file as File).type ?? 'application/octet-stream',
          cacheControl: '3600',
        },
        onProgress: (uploaded, total) => onProgress?.(uploaded, total),
        onSuccess: () => resolve(),
        onError: (error) => reject(normalizeError(error)),
      });

      // Если этот же файл уже грузился и оборвался — продолжаем с места обрыва.
      const previous = await upload.findPreviousUploads();
      if (previous.length > 0) upload.resumeFromPreviousUpload(previous[0]);

      upload.start();
    })().catch(reject);
  });

  return {
    promise,
    abort: () => {
      aborted = true;
      upload?.abort(true);
    },
  };
}

function normalizeError(error: Error): Error {
  const text = error.message ?? '';
  if (text.includes('413') || text.toLowerCase().includes('payload too large')) {
    return new Error(
      'Файл больше лимита проекта. Поднимите лимит в Supabase → Storage → Settings.',
    );
  }
  if (text.includes('401') || text.includes('403')) {
    return new Error('Нет доступа к хранилищу. Проверьте, что вы вошли.');
  }
  return new Error('Не удалось загрузить файл. Проверьте соединение.');
}
