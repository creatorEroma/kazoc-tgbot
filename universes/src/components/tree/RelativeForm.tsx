'use client';

import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useUploader } from '@/hooks/useUploader';
import MediaPicker from '@/components/media/MediaPicker';
import type { Relative } from '@/lib/types';
import type { UniverseSlug } from '@/lib/constants';

interface Props {
  universe: UniverseSlug;
  userSlug: string;
  initial?: Relative | null;
  onSaved: (relative: Relative) => void;
  onCancel: () => void;
}

/** Форма родственника. Правит любой из двоих — права равные. */
export default function RelativeForm({ universe, userSlug, initial, onSaved, onCancel }: Props) {
  const [form, setForm] = useState({
    full_name: initial?.full_name ?? '',
    kinship: initial?.kinship ?? '',
    birth_date: initial?.birth_date ?? '',
    city: initial?.city ?? '',
    address: initial?.address ?? '',
    phone: initial?.phone ?? '',
    notes: initial?.notes ?? '',
    is_alive: initial?.is_alive ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const uploader = useUploader({ userSlug });

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    if (!form.full_name.trim()) {
      setError('Впишите имя — без него карточку не сохранить.');
      return;
    }

    setSaving(true);
    setError(null);

    const supabase = supabaseBrowser();
    const { data: auth } = await supabase.auth.getUser();
    const photo = uploader.collect()[0];

    const payload = {
      universe,
      full_name: form.full_name.trim(),
      kinship: form.kinship.trim() || null,
      birth_date: form.birth_date || null,
      city: form.city.trim() || null,
      address: form.address.trim() || null,
      phone: form.phone.trim() || null,
      notes: form.notes.trim() || null,
      is_alive: form.is_alive,
      updated_by: auth.user?.id ?? null,
      ...(photo ? { photo_path: photo.path } : {}),
    };

    const query = initial
      ? supabase.from('relatives').update(payload).eq('id', initial.id).select('*').single()
      : supabase
          .from('relatives')
          .insert({ ...payload, created_by: auth.user?.id ?? null })
          .select('*')
          .single();

    const { data, error: saveError } = await query;
    setSaving(false);

    if (saveError || !data) {
      setError('Не удалось сохранить. Попробуйте ещё раз.');
      return;
    }

    uploader.reset();
    onSaved(data as Relative);
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="label" htmlFor="full_name">ФИО</label>
        <input
          id="full_name"
          className="field"
          placeholder="Например, Айгуль Сериковна"
          value={form.full_name}
          onChange={(e) => set('full_name', e.target.value)}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="kinship">Кем приходится</label>
          <input
            id="kinship"
            className="field"
            placeholder="Мама, дядя, бабушка…"
            value={form.kinship}
            onChange={(e) => set('kinship', e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="birth_date">Дата рождения</label>
          <input
            id="birth_date"
            type="date"
            className="field"
            value={form.birth_date ?? ''}
            onChange={(e) => set('birth_date', e.target.value)}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="city">Город</label>
          <input
            id="city"
            className="field"
            placeholder="Алматы"
            value={form.city}
            onChange={(e) => set('city', e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="phone">Телефон</label>
          <input
            id="phone"
            className="field"
            placeholder="+7 700 000 00 00"
            value={form.phone}
            onChange={(e) => set('phone', e.target.value)}
          />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="address">Адрес</label>
        <input
          id="address"
          className="field"
          placeholder="Улица, дом, квартира"
          value={form.address}
          onChange={(e) => set('address', e.target.value)}
        />
      </div>

      <div>
        <label className="label" htmlFor="notes">Заметки</label>
        <textarea
          id="notes"
          className="field min-h-[80px] resize-y"
          placeholder="Что важно помнить об этом человеке"
          value={form.notes}
          onChange={(e) => set('notes', e.target.value)}
        />
      </div>

      <label className="flex items-center gap-2 text-[14px] text-ink">
        <input
          type="checkbox"
          checked={form.is_alive}
          onChange={(e) => set('is_alive', e.target.checked)}
          className="h-4 w-4 accent-current text-rose"
        />
        С нами
      </label>

      <div>
        <p className="label">Фотография</p>
        <MediaPicker
          tasks={uploader.tasks}
          onAdd={(files) => uploader.add(files.slice(0, 1))}
          onRemove={uploader.remove}
          totalBytes={uploader.totalBytes}
          uploadedBytes={uploader.uploadedBytes}
          label="Выбрать фото"
          accept="image/*"
        />
      </div>

      {error && <p className="text-[13px] text-rose">{error}</p>}

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" className="btn-ghost" onClick={onCancel}>
          Отмена
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={save}
          disabled={saving || uploader.busy}
        >
          {uploader.busy ? 'Фото грузится…' : saving ? 'Сохраняем…' : 'Сохранить'}
        </button>
      </div>
    </div>
  );
}
