'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useUploader } from '@/hooks/useUploader';
import MediaPicker from '@/components/media/MediaPicker';
import MediaGrid from '@/components/media/MediaGrid';
import { withCount } from '@/lib/format';
import type { Album, MediaItem, Profile } from '@/lib/types';

interface Props {
  me: Profile;
}

const PAGE = 30;
const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

/** Галерея: всё, что загружено в облако, сгруппировано по месяцам,
 *  плюс альбомы для того, что хочется держать вместе. */
export default function GalleryScreen({ me }: Props) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [albumId, setAlbumId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState(false);
  const [uploading, setUploading] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);

  const uploader = useUploader({ userSlug: me.slug });

  const load = useCallback(
    async (cursor?: string | null, replace = false) => {
      if (loadingRef.current) return;
      loadingRef.current = true;

      const supabase = supabaseBrowser();
      let query = supabase
        .from('media')
        .select('*')
        .in('kind', ['image', 'video'])
        .is('message_id', null)
        .order('created_at', { ascending: false })
        .limit(PAGE);

      if (albumId) query = query.eq('album_id', albumId);
      if (cursor) query = query.lt('created_at', cursor);

      const { data } = await query;
      const page = (data ?? []) as MediaItem[];

      setItems((prev) => {
        const base = replace ? [] : prev;
        const seen = new Set(base.map((m) => m.id));
        return [...base, ...page.filter((m) => !seen.has(m.id))];
      });

      if (page.length < PAGE) setDone(true);
      setLoading(false);
      loadingRef.current = false;
    },
    [albumId],
  );

  useEffect(() => {
    setDone(false);
    setLoading(true);
    void load(null, true);
  }, [load]);

  useEffect(() => {
    const supabase = supabaseBrowser();
    void supabase
      .from('albums')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data }) => setAlbums((data ?? []) as Album[]));
  }, []);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || done) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void load(items[items.length - 1]?.created_at ?? null);
      },
      { rootMargin: '500px' },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [done, items, load]);

  async function saveUploads() {
    const files = uploader.collect();
    if (files.length === 0) return;

    const supabase = supabaseBrowser();
    const rows = files.map((file) => ({
      owner: me.id,
      bucket: file.bucket,
      path: file.path,
      mime: file.mime,
      kind: file.kind,
      size_bytes: file.size_bytes,
      width: file.width,
      height: file.height,
      duration_sec: file.duration_sec,
      poster_path: file.poster_path,
      album_id: albumId,
    }));

    const { data } = await supabase.from('media').insert(rows).select('*');
    setItems((prev) => [...((data ?? []) as MediaItem[]), ...prev]);
    uploader.reset();
    setUploading(false);
  }

  async function createAlbum() {
    const title = prompt('Название альбома');
    if (!title?.trim()) return;

    const supabase = supabaseBrowser();
    const { data } = await supabase
      .from('albums')
      .insert({ title: title.trim(), created_by: me.id, scope: 'shared' })
      .select('*')
      .single();

    if (data) {
      setAlbums((prev) => [data as Album, ...prev]);
      setAlbumId((data as Album).id);
    }
  }

  const groups = useMemo(() => {
    const map = new Map<string, MediaItem[]>();
    items.forEach((item) => {
      const date = new Date(item.taken_at ?? item.created_at);
      const key = `${date.getFullYear()}-${date.getMonth()}`;
      map.set(key, [...(map.get(key) ?? []), item]);
    });

    return Array.from(map.entries()).map(([key, list]) => {
      const [year, month] = key.split('-').map(Number);
      const now = new Date();
      const title = year === now.getFullYear() ? MONTHS[month] : `${MONTHS[month]} ${year}`;
      return { key, title, list };
    });
  }, [items]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setAlbumId(null)}
          className={`chip ${albumId === null ? 'border-rose text-rose' : ''}`}
        >
          Всё
        </button>

        {albums.map((album) => (
          <button
            key={album.id}
            type="button"
            onClick={() => setAlbumId(album.id)}
            className={`chip ${albumId === album.id ? 'border-rose text-rose' : ''}`}
          >
            {album.title}
          </button>
        ))}

        <button type="button" onClick={createAlbum} className="chip hover:text-ink">
          + Альбом
        </button>

        <button type="button" className="btn-primary ml-auto" onClick={() => setUploading((v) => !v)}>
          {uploading ? 'Свернуть' : '+ Загрузить'}
        </button>
      </div>

      {uploading && (
        <div className="card mb-4 p-4">
          <MediaPicker
            tasks={uploader.tasks}
            onAdd={uploader.add}
            onRemove={uploader.remove}
            totalBytes={uploader.totalBytes}
            uploadedBytes={uploader.uploadedBytes}
            label="Выбрать фото и видео"
          />
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              className="btn-primary"
              onClick={saveUploads}
              disabled={uploader.busy || uploader.tasks.length === 0}
            >
              {uploader.busy ? 'Файлы грузятся…' : 'Добавить в галерею'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-3 gap-1.5">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="aspect-square skeleton" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="font-display text-[18px] text-ink">Здесь будут ваши фотографии</p>
          <p className="mx-auto mt-2 max-w-sm text-[14px] text-muted">
            Загружайте что угодно: тяжёлые видео тоже, они грузятся частями и
            хранятся в облаке.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.key}>
              <h2 className="mb-2 flex items-baseline gap-2">
                <span className="font-display text-[17px] text-ink">{group.title}</span>
                <span className="text-[12.5px] text-muted">
                  {withCount(group.list.length, 'файл', 'файла', 'файлов')}
                </span>
              </h2>
              <MediaGrid items={group.list} />
            </section>
          ))}
        </div>
      )}

      <div ref={sentinel} className="h-px" />
    </div>
  );
}
