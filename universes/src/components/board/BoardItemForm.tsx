'use client';

import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useUploader } from '@/hooks/useUploader';
import MediaPicker from '@/components/media/MediaPicker';
import { PRIORITY_LABELS, STATUS_LABELS, type BoardKind, type UniverseSlug } from '@/lib/constants';
import type { BoardItem } from '@/lib/types';

interface Props {
  kind: BoardKind;
  scope: 'personal' | 'shared';
  universe: UniverseSlug;
  userSlug: string;
  initial?: BoardItem | null;
  onSaved: (item: BoardItem) => void;
  onCancel: () => void;
}

export default function BoardItemForm({
  kind,
  scope,
  universe,
  userSlug,
  initial,
  onSaved,
  onCancel,
}: Props) {
  const [form, setForm] = useState({
    title: initial?.title ?? '',
    description: initial?.description ?? '',
    link: initial?.link ?? '',
    price: initial?.price?.toString() ?? '',
    currency: initial?.currency ?? 'KZT',
    priority: initial?.priority ?? 2,
    status: initial?.status ?? 'idea',
    due_date: initial?.due_date ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uploader = useUploader({ userSlug });

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    if (!form.title.trim()) {
      setError('Название не может быть пустым.');
      return;
    }

    setSaving(true);
    setError(null);

    const supabase = supabaseBrowser();
    const { data: auth } = await supabase.auth.getUser();
    const cover = uploader.collect()[0];

    const payload = {
      kind,
      scope,
      universe,
      title: form.title.trim(),
      description: form.description.trim() || null,
      link: form.link.trim() || null,
      price: form.price ? Number(form.price.replace(',', '.')) : null,
      currency: form.currency,
      priority: form.priority,
      status: form.status,
      due_date: form.due_date || null,
      ...(cover ? { cover_path: cover.path } : {}),
    };

    const query = initial
      ? supabase.from('board_items').update(payload).eq('id', initial.id).select('*').single()
      : supabase
          .from('board_items')
          .insert({ ...payload, owner: auth.user?.id })
          .select('*')
          .single();

    const { data, error: saveError } = await query;
    setSaving(false);

    if (saveError || !data) {
      setError('Не удалось сохранить. Попробуйте ещё раз.');
      return;
    }

    uploader.reset();
    onSaved(data as BoardItem);
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="label" htmlFor="title">Название</label>
        <input
          id="title"
          className="field"
          placeholder="Например, поехать в Грузию"
          value={form.title}
          onChange={(e) => set('title', e.target.value)}
          autoFocus
        />
      </div>

      <div>
        <label className="label" htmlFor="description">Описание</label>
        <textarea
          id="description"
          className="field min-h-[80px] resize-y"
          placeholder="Детали, мысли, почему это важно"
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
        />
      </div>

      <div>
        <label className="label" htmlFor="link">Ссылка на товар</label>
        <input
          id="link"
          className="field"
          placeholder="https://"
          value={form.link}
          onChange={(e) => set('link', e.target.value)}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="price">Цена</label>
          <input
            id="price"
            inputMode="decimal"
            className="field"
            placeholder="0"
            value={form.price}
            onChange={(e) => set('price', e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="currency">Валюта</label>
          <select
            id="currency"
            className="field"
            value={form.currency}
            onChange={(e) => set('currency', e.target.value)}
          >
            <option value="KZT">₸ тенге</option>
            <option value="RUB">₽ рубли</option>
            <option value="USD">$ доллары</option>
            <option value="EUR">€ евро</option>
          </select>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="priority">Важность</label>
          <select
            id="priority"
            className="field"
            value={form.priority}
            onChange={(e) => set('priority', Number(e.target.value) as 1 | 2 | 3)}
          >
            {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="status">Статус</label>
          <select
            id="status"
            className="field"
            value={form.status}
            onChange={(e) => set('status', e.target.value as BoardItem['status'])}
          >
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="due_date">Срок</label>
          <input
            id="due_date"
            type="date"
            className="field"
            value={form.due_date ?? ''}
            onChange={(e) => set('due_date', e.target.value)}
          />
        </div>
      </div>

      <div>
        <p className="label">Фото</p>
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
        <button type="button" className="btn-primary" onClick={save} disabled={saving || uploader.busy}>
          {uploader.busy ? 'Фото грузится…' : saving ? 'Сохраняем…' : 'Сохранить'}
        </button>
      </div>
    </div>
  );
}
