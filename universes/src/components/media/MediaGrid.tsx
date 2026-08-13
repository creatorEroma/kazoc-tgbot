'use client';

import { useEffect, useState } from 'react';
import { useSignedUrl } from '@/lib/media';
import { formatDuration } from '@/lib/format';
import type { MediaItem } from '@/lib/types';

interface Props {
  items: MediaItem[];
  /** blob-URL по id — превью для файлов, которые ещё догружаются. */
  localPreviews?: Record<string, string>;
}

/** Сетка вложений как в VK: одно фото крупно, несколько — плиткой. */
export default function MediaGrid({ items, localPreviews }: Props) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const visual = items.filter((m) => m.kind === 'image' || m.kind === 'video');

  if (visual.length === 0) return null;

  const layout =
    visual.length === 1
      ? 'grid-cols-1'
      : visual.length === 2
        ? 'grid-cols-2'
        : 'grid-cols-2 sm:grid-cols-3';

  return (
    <>
      <div className={`mt-2.5 grid gap-1.5 ${layout}`}>
        {visual.map((item, index) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setOpenIndex(index)}
            className={`relative overflow-hidden rounded-soft border border-line bg-raised transition hover:opacity-95 ${
              visual.length === 1 ? 'max-h-[70vh]' : 'aspect-square'
            }`}
          >
            <Thumb item={item} localUrl={localPreviews?.[item.id]} single={visual.length === 1} />
          </button>
        ))}
      </div>

      {openIndex !== null && (
        <Lightbox
          items={visual}
          index={openIndex}
          onClose={() => setOpenIndex(null)}
          onIndex={setOpenIndex}
          localPreviews={localPreviews}
        />
      )}
    </>
  );
}

function Thumb({ item, localUrl, single }: { item: MediaItem; localUrl?: string; single: boolean }) {
  const posterUrl = useSignedUrl(item.bucket, item.poster_path ?? item.path, localUrl);

  return (
    <>
      {item.kind === 'video' && !item.poster_path && posterUrl ? (
        <video
          src={posterUrl}
          className={single ? 'max-h-[70vh] w-full object-contain' : 'h-full w-full object-cover'}
          muted
          playsInline
          preload="metadata"
        />
      ) : posterUrl ? (
        <img
          src={posterUrl}
          alt=""
          loading="lazy"
          className={single ? 'max-h-[70vh] w-full object-contain' : 'h-full w-full object-cover'}
          style={
            single && item.width && item.height
              ? { aspectRatio: `${item.width} / ${item.height}` }
              : undefined
          }
        />
      ) : (
        <div className={single ? 'aspect-video w-full skeleton' : 'h-full w-full skeleton'} />
      )}

      {item.kind === 'video' && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-ink/55 text-surface backdrop-blur-sm">
            ▶
          </span>
        </span>
      )}

      {item.kind === 'video' && item.duration_sec ? (
        <span className="pointer-events-none absolute bottom-1.5 right-1.5 rounded-full bg-ink/60 px-2 py-0.5 text-[11px] font-medium text-surface">
          {formatDuration(item.duration_sec)}
        </span>
      ) : null}
    </>
  );
}

function Lightbox({
  items,
  index,
  onClose,
  onIndex,
  localPreviews,
}: {
  items: MediaItem[];
  index: number;
  onClose: () => void;
  onIndex: (i: number) => void;
  localPreviews?: Record<string, string>;
}) {
  const item = items[index];
  const url = useSignedUrl(item.bucket, item.path, localPreviews?.[item.id]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowRight') onIndex((index + 1) % items.length);
      if (event.key === 'ArrowLeft') onIndex((index - 1 + items.length) % items.length);
    }
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [index, items.length, onClose, onIndex]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/90 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Закрыть"
        className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-surface/15 text-xl text-surface"
      >
        ×
      </button>

      {items.length > 1 && (
        <>
          <NavButton side="left" onClick={(e) => { e.stopPropagation(); onIndex((index - 1 + items.length) % items.length); }} />
          <NavButton side="right" onClick={(e) => { e.stopPropagation(); onIndex((index + 1) % items.length); }} />
        </>
      )}

      <div className="max-h-full max-w-5xl" onClick={(e) => e.stopPropagation()}>
        {!url ? (
          <div className="h-64 w-64 skeleton" />
        ) : item.kind === 'video' ? (
          <video src={url} className="max-h-[86dvh] w-full rounded-soft" controls autoPlay playsInline />
        ) : (
          <img src={url} alt="" className="max-h-[86dvh] w-auto rounded-soft object-contain" />
        )}

        {items.length > 1 && (
          <p className="mt-3 text-center text-[13px] text-surface/70">
            {index + 1} из {items.length}
          </p>
        )}
      </div>
    </div>
  );
}

function NavButton({ side, onClick }: { side: 'left' | 'right'; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === 'left' ? 'Предыдущее' : 'Следующее'}
      className={`absolute ${side === 'left' ? 'left-3' : 'right-3'} top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-surface/15 text-surface`}
    >
      {side === 'left' ? '‹' : '›'}
    </button>
  );
}
