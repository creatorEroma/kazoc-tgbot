'use client';

import { useEffect, useState } from 'react';
import { supabaseBrowser } from './supabase/client';

const TTL_SEC = 60 * 60;
const cache = new Map<string, { url: string; expires: number }>();

/** Подписанная ссылка на приватный файл. Ссылки кэшируются на час,
 *  иначе галерея на сотню файлов дёргает Storage сотню раз при каждом рендере. */
export async function signedUrl(bucket: string, path: string): Promise<string | null> {
  const key = `${bucket}/${path}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.url;

  const supabase = supabaseBrowser();
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, TTL_SEC);
  if (error || !data?.signedUrl) return null;

  cache.set(key, { url: data.signedUrl, expires: Date.now() + (TTL_SEC - 60) * 1000 });
  return data.signedUrl;
}

/** Подписанные ссылки пачкой — один запрос на бакет вместо N. */
export async function signedUrls(bucket: string, paths: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const missing: string[] = [];

  for (const path of paths) {
    const hit = cache.get(`${bucket}/${path}`);
    if (hit && hit.expires > Date.now()) result.set(path, hit.url);
    else missing.push(path);
  }

  if (missing.length > 0) {
    const supabase = supabaseBrowser();
    const { data } = await supabase.storage.from(bucket).createSignedUrls(missing, TTL_SEC);
    data?.forEach((row) => {
      if (row.signedUrl && row.path) {
        cache.set(`${bucket}/${row.path}`, {
          url: row.signedUrl,
          expires: Date.now() + (TTL_SEC - 60) * 1000,
        });
        result.set(row.path, row.signedUrl);
      }
    });
  }

  return result;
}

/** Ссылка на файл внутри компонента. localUrl — превью до окончания загрузки. */
export function useSignedUrl(
  bucket: string | null | undefined,
  path: string | null | undefined,
  localUrl?: string,
) {
  const [url, setUrl] = useState<string | null>(localUrl ?? null);

  useEffect(() => {
    let alive = true;
    if (localUrl) {
      setUrl(localUrl);
      return;
    }
    if (!bucket || !path) {
      setUrl(null);
      return;
    }
    signedUrl(bucket, path).then((value) => {
      if (alive) setUrl(value);
    });
    return () => {
      alive = false;
    };
  }, [bucket, path, localUrl]);

  return url;
}

/** Путь в бакете: раскладываем по годам и месяцам, чтобы папка не распухала. */
export function storagePath(userSlug: string, fileName: string): string {
  const now = new Date();
  const stamp = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;
  const safe = fileName
    .normalize('NFKD')
    .replace(/[^\w.\-]+/g, '_')
    .slice(-80);
  return `${userSlug}/${stamp}/${crypto.randomUUID()}_${safe}`;
}

export function mediaKindOf(mime: string): 'image' | 'video' | 'audio' | 'file' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}
