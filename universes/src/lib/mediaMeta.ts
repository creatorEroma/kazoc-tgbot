'use client';

import { mediaKindOf } from './media';

export interface ProbedMedia {
  kind: 'image' | 'video' | 'audio' | 'file';
  width: number | null;
  height: number | null;
  duration: number | null;
  poster: Blob | null;
  previewUrl: string;
}

/** Снимаем размеры, длительность и кадр-постер прямо в браузере — сервер
 *  для этого не нужен, а лента получает превью мгновенно. */
export async function probeMedia(file: File): Promise<ProbedMedia> {
  const kind = mediaKindOf(file.type);
  const previewUrl = URL.createObjectURL(file);
  const base: ProbedMedia = { kind, width: null, height: null, duration: null, poster: null, previewUrl };

  try {
    if (kind === 'image') {
      const size = await imageSize(previewUrl);
      return { ...base, ...size };
    }
    if (kind === 'video') {
      return { ...base, ...(await videoMeta(previewUrl)) };
    }
    if (kind === 'audio') {
      return { ...base, duration: await audioDuration(previewUrl) };
    }
  } catch {
    // Метаданные — приятный бонус, а не условие загрузки: не вышло, грузим как есть.
  }

  return base;
}

function imageSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('image'));
    img.src = url;
  });
}

function videoMeta(url: string): Promise<{ width: number; height: number; duration: number; poster: Blob | null }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    video.onloadedmetadata = () => {
      const width = video.videoWidth;
      const height = video.videoHeight;
      const duration = video.duration;

      // Кадр для постера берём чуть позже нуля — на нулевой секунде часто чёрный экран.
      const seekTo = Math.min(0.5, Math.max(0, duration - 0.1));
      video.onseeked = async () => {
        let poster: Blob | null = null;
        try {
          const canvas = document.createElement('canvas');
          const scale = Math.min(1, 1280 / Math.max(width, height || 1));
          canvas.width = Math.round(width * scale);
          canvas.height = Math.round(height * scale);
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            poster = await new Promise<Blob | null>((res) =>
              canvas.toBlob((blob) => res(blob), 'image/jpeg', 0.82),
            );
          }
        } catch {
          poster = null;
        }
        resolve({ width, height, duration, poster });
      };
      video.currentTime = seekTo;
    };

    video.onerror = () => reject(new Error('video'));
    video.src = url;
  });
}

function audioDuration(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => resolve(audio.duration);
    audio.onerror = () => reject(new Error('audio'));
    audio.src = url;
  });
}

/** Пики громкости для дорожки голосового: 48 столбиков — ровно столько
 *  влезает в пузырь сообщения, не превращаясь в кашу. */
export async function computeWaveform(blob: Blob, buckets = 48): Promise<number[] | null> {
  try {
    const AudioCtx =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    const channel = buffer.getChannelData(0);
    const step = Math.floor(channel.length / buckets) || 1;
    const peaks: number[] = [];

    for (let i = 0; i < buckets; i += 1) {
      let peak = 0;
      const start = i * step;
      for (let j = start; j < start + step && j < channel.length; j += 1) {
        const value = Math.abs(channel[j]);
        if (value > peak) peak = value;
      }
      peaks.push(peak);
    }

    void ctx.close();

    const max = Math.max(...peaks, 0.01);
    return peaks.map((p) => Math.round((p / max) * 100) / 100);
  } catch {
    return null;
  }
}
