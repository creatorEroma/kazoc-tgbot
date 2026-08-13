'use client';

import { useEffect, useRef, useState } from 'react';
import { computeWaveform } from '@/lib/mediaMeta';
import { formatDuration } from '@/lib/format';

export interface RecordedVoice {
  blob: Blob;
  mime: string;
  duration: number;
  waveform: number[] | null;
}

interface Props {
  onRecorded: (voice: RecordedVoice) => void;
  onCancel?: () => void;
}

/** Запись голосового: живая волна, таймер, отмена. */
export default function VoiceRecorder({ onRecorded, onCancel }: Props) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const canceledRef = useRef(false);
  const startedAtRef = useRef(0);

  useEffect(() => () => teardown(), []);

  function teardown() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    void audioCtxRef.current?.close().catch(() => undefined);
    rafRef.current = null;
    timerRef.current = null;
    streamRef.current = null;
    audioCtxRef.current = null;
  }

  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      canceledRef.current = false;
      chunksRef.current = [];

      const mime = pickMime();
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        const duration = (Date.now() - startedAtRef.current) / 1000;
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        teardown();
        setRecording(false);
        setLevels([]);
        setSeconds(0);

        if (canceledRef.current || blob.size === 0 || duration < 0.4) {
          onCancel?.();
          return;
        }

        const waveform = await computeWaveform(blob);
        onRecorded({ blob, mime: blob.type, duration, waveform });
      };

      startedAtRef.current = Date.now();
      recorder.start(250);
      setRecording(true);

      timerRef.current = setInterval(() => {
        setSeconds((Date.now() - startedAtRef.current) / 1000);
      }, 200);

      drawLevels(stream);
    } catch {
      setError('Нет доступа к микрофону. Разрешите запись в настройках браузера.');
    }
  }

  function drawLevels(stream: MediaStream) {
    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    audioCtxRef.current = ctx;

    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);

    const buffer = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      analyser.getByteTimeDomainData(buffer);
      let peak = 0;
      for (let i = 0; i < buffer.length; i += 1) {
        peak = Math.max(peak, Math.abs(buffer[i] - 128) / 128);
      }
      setLevels((prev) => [...prev.slice(-47), Math.min(1, peak * 1.8)]);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
  }

  function stop(canceled: boolean) {
    canceledRef.current = canceled;
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    } else {
      teardown();
      setRecording(false);
      if (canceled) onCancel?.();
    }
  }

  if (error) {
    return (
      <div className="flex items-center gap-3">
        <p className="text-[13px] text-rose">{error}</p>
        <button type="button" className="btn-quiet" onClick={() => setError(null)}>
          Понятно
        </button>
      </div>
    );
  }

  if (!recording) {
    return (
      <button
        type="button"
        onClick={start}
        aria-label="Записать голосовое"
        className="flex h-10 w-10 flex-none items-center justify-center rounded-full text-muted transition hover:bg-raised hover:text-ink"
      >
        ●
      </button>
    );
  }

  return (
    <div className="flex flex-1 items-center gap-3 rounded-full border border-line bg-surface px-3 py-1.5">
      <span className="h-2.5 w-2.5 flex-none animate-pulse-soft rounded-full bg-rose" />
      <span className="tabular-nums text-[13px] text-muted">{formatDuration(seconds)}</span>

      <div className="flex h-7 flex-1 items-center gap-[2px] overflow-hidden">
        {levels.map((level, index) => (
          <span
            key={index}
            className="w-full flex-none rounded-full bg-rose/70"
            style={{ height: `${Math.max(10, level * 100)}%` }}
          />
        ))}
      </div>

      <button type="button" className="btn-quiet px-2" onClick={() => stop(true)}>
        Отмена
      </button>
      <button type="button" className="btn-primary px-4 py-1.5" onClick={() => stop(false)}>
        Готово
      </button>
    </div>
  );
}

function pickMime(): string | undefined {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return candidates.find((mime) => MediaRecorder.isTypeSupported(mime));
}
