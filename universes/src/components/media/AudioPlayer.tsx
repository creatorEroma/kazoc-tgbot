'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSignedUrl } from '@/lib/media';
import { formatDuration } from '@/lib/format';

interface Props {
  bucket: string;
  path: string;
  duration?: number | null;
  waveform?: number[] | null;
  localUrl?: string;
  /** true — пузырь собеседника, дорожка рисуется в цвете акцента. */
  incoming?: boolean;
}

const SPEEDS = [1, 1.5, 2] as const;

/** Аккуратный плеер голосовых: волна, таймкоды, перемотка, скорость. */
export default function AudioPlayer({
  bucket,
  path,
  duration,
  waveform,
  localUrl,
  incoming = false,
}: Props) {
  const url = useSignedUrl(bucket, path, localUrl);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(duration ?? 0);
  const [speed, setSpeed] = useState<number>(1);

  const bars = waveform && waveform.length > 0 ? waveform : defaultBars;
  const progress = total > 0 ? Math.min(current / total, 1) : 0;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = speed;
  }, [speed]);

  const toggle = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !url) return;

    if (playing) {
      audio.pause();
      return;
    }
    // Одновременно звучит только одно голосовое.
    document.querySelectorAll('audio').forEach((el) => {
      if (el !== audio) el.pause();
    });
    try {
      await audio.play();
    } catch {
      setPlaying(false);
    }
  }, [playing, url]);

  function seek(event: React.MouseEvent<HTMLDivElement>) {
    const audio = audioRef.current;
    if (!audio || !total) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
    audio.currentTime = ratio * total;
    setCurrent(audio.currentTime);
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={toggle}
        disabled={!url}
        aria-label={playing ? 'Пауза' : 'Слушать'}
        className={`flex h-10 w-10 flex-none items-center justify-center rounded-full text-sm transition ${
          incoming ? 'bg-rose text-surface' : 'bg-ink text-surface'
        } disabled:opacity-50`}
      >
        {playing ? '❚❚' : '▶'}
      </button>

      <div className="min-w-0 flex-1">
        <div
          className="flex h-8 cursor-pointer items-center gap-[2px]"
          onClick={seek}
          role="slider"
          aria-label="Перемотка"
          aria-valuemin={0}
          aria-valuemax={Math.round(total)}
          aria-valuenow={Math.round(current)}
          tabIndex={0}
        >
          {bars.map((value, index) => {
            const played = index / bars.length <= progress;
            return (
              <span
                key={index}
                className={`w-full rounded-full transition-colors ${
                  played ? (incoming ? 'bg-rose' : 'bg-ink') : 'bg-line'
                }`}
                style={{ height: `${Math.max(12, value * 100)}%` }}
              />
            );
          })}
        </div>

        <div className="mt-1 flex items-center justify-between text-[11.5px] text-muted">
          <span className="tabular-nums">
            {formatDuration(playing || current > 0 ? current : total)}
          </span>
          <button
            type="button"
            onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed as 1) + 1) % SPEEDS.length])}
            className="rounded-full px-1.5 hover:bg-raised"
          >
            {speed}×
          </button>
        </div>
      </div>

      {url && (
        <audio
          ref={audioRef}
          src={url}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setCurrent(0);
          }}
          onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => {
            const value = e.currentTarget.duration;
            if (Number.isFinite(value) && value > 0) setTotal(value);
          }}
        />
      )}
    </div>
  );
}

/** Запасная волна, если пики не посчитались: ровная, но живая. */
const defaultBars = Array.from({ length: 48 }, (_, i) => 0.35 + Math.abs(Math.sin(i / 3.1)) * 0.5);
