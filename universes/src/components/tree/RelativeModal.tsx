'use client';

import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useSignedUrl } from '@/lib/media';
import { formatDate } from '@/lib/format';
import { RELATION_LABELS, type RelationType, type UniverseSlug } from '@/lib/constants';
import RelativeForm from './RelativeForm';
import type { Relative, RelativeRelation } from '@/lib/types';

interface Props {
  relative: Relative;
  all: Relative[];
  relations: RelativeRelation[];
  universe: UniverseSlug;
  userSlug: string;
  onClose: () => void;
  onOpen: (id: string) => void;
  onSaved: (relative: Relative) => void;
  onDeleted: (id: string) => void;
  onRelationsChanged: () => void;
}

/** Карточка родственника: кто это, как связан, где живёт и как позвонить. */
export default function RelativeModal({
  relative,
  all,
  relations,
  universe,
  userSlug,
  onClose,
  onOpen,
  onSaved,
  onDeleted,
  onRelationsChanged,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [addingRelation, setAddingRelation] = useState(false);
  const [relationType, setRelationType] = useState<RelationType>('parent');
  const [relationTarget, setRelationTarget] = useState('');
  const photo = useSignedUrl('media', relative.photo_path);

  const byId = new Map(all.map((person) => [person.id, person]));
  const links = relations.filter((relation) => relation.from_id === relative.id);

  const grouped = (Object.keys(RELATION_LABELS) as RelationType[])
    .map((type) => ({
      type,
      people: links
        .filter((relation) => relation.type === type)
        .map((relation) => byId.get(relation.to_id))
        .filter(Boolean) as Relative[],
    }))
    .filter((group) => group.people.length > 0);

  async function addRelation() {
    if (!relationTarget) return;
    const supabase = supabaseBrowser();
    await supabase
      .from('relative_relations')
      .insert({ from_id: relative.id, to_id: relationTarget, type: relationType });
    setAddingRelation(false);
    setRelationTarget('');
    onRelationsChanged();
  }

  async function removeRelation(toId: string, type: RelationType) {
    const supabase = supabaseBrowser();
    await supabase
      .from('relative_relations')
      .delete()
      .eq('from_id', relative.id)
      .eq('to_id', toId)
      .eq('type', type);
    onRelationsChanged();
  }

  async function remove() {
    if (!confirm(`Удалить карточку «${relative.full_name}»? Связи с ней тоже исчезнут.`)) return;
    const supabase = supabaseBrowser();
    await supabase.from('relatives').delete().eq('id', relative.id);
    onDeleted(relative.id);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="max-h-[92dvh] w-full max-w-lg animate-fade-up overflow-y-auto rounded-t-card border border-line bg-surface p-5 shadow-lift sm:rounded-card"
        onClick={(e) => e.stopPropagation()}
      >
        {editing ? (
          <>
            <h2 className="mb-4 font-display text-[20px] text-ink">Редактирование</h2>
            <RelativeForm
              universe={universe}
              userSlug={userSlug}
              initial={relative}
              onSaved={(saved) => {
                setEditing(false);
                onSaved(saved);
              }}
              onCancel={() => setEditing(false)}
            />
          </>
        ) : (
          <>
            <div className="flex items-start gap-4">
              {photo ? (
                <img
                  src={photo}
                  alt=""
                  className="h-20 w-20 flex-none rounded-full border border-line object-cover"
                />
              ) : (
                <span className="flex h-20 w-20 flex-none items-center justify-center rounded-full bg-rose/15 font-display text-2xl text-rose">
                  {relative.full_name.charAt(0)}
                </span>
              )}

              <div className="min-w-0 flex-1">
                <h2 className="font-display text-[22px] leading-tight text-ink">
                  {relative.full_name}
                </h2>
                {relative.kinship && <p className="mt-0.5 text-[14px] text-muted">{relative.kinship}</p>}
                {!relative.is_alive && (
                  <p className="mt-1 text-[12.5px] text-muted">Светлая память</p>
                )}
              </div>

              <button type="button" onClick={onClose} className="btn-quiet px-2" aria-label="Закрыть">
                ×
              </button>
            </div>

            <dl className="mt-5 space-y-2.5 text-[14.5px]">
              <Row label="Дата рождения" value={formatDate(relative.birth_date)} />
              <Row label="Город" value={relative.city} />
              <Row label="Адрес" value={relative.address} />
              <Row
                label="Телефон"
                value={
                  relative.phone ? (
                    <a href={`tel:${relative.phone.replace(/\s/g, '')}`} className="text-rose">
                      {relative.phone}
                    </a>
                  ) : null
                }
              />
              <Row label="Заметки" value={relative.notes} />
            </dl>

            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted">Связи</h3>
                <button
                  type="button"
                  className="btn-quiet px-2 py-1 text-[13px]"
                  onClick={() => setAddingRelation((v) => !v)}
                >
                  {addingRelation ? 'Свернуть' : '+ Добавить связь'}
                </button>
              </div>

              {addingRelation && (
                <div className="mb-3 space-y-2 rounded-soft border border-line bg-raised/50 p-3">
                  <select
                    className="field"
                    value={relationType}
                    onChange={(e) => setRelationType(e.target.value as RelationType)}
                  >
                    {(Object.keys(RELATION_LABELS) as RelationType[]).map((type) => (
                      <option key={type} value={type}>
                        {RELATION_LABELS[type]}
                      </option>
                    ))}
                  </select>

                  <select
                    className="field"
                    value={relationTarget}
                    onChange={(e) => setRelationTarget(e.target.value)}
                  >
                    <option value="">Выберите человека</option>
                    {all
                      .filter((person) => person.id !== relative.id)
                      .map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.full_name}
                        </option>
                      ))}
                  </select>

                  <button
                    type="button"
                    className="btn-primary w-full"
                    onClick={addRelation}
                    disabled={!relationTarget}
                  >
                    Связать
                  </button>
                  <p className="text-[12px] text-muted">
                    Обратная связь создастся сама: родитель ↔ ребёнок, супруги и
                    братья/сёстры — взаимно.
                  </p>
                </div>
              )}

              {grouped.length === 0 ? (
                <p className="text-[13.5px] text-muted">Связей пока нет.</p>
              ) : (
                <div className="space-y-2.5">
                  {grouped.map((group) => (
                    <div key={group.type}>
                      <p className="text-[12.5px] text-muted">{RELATION_LABELS[group.type]}</p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {group.people.map((person) => (
                          <span key={person.id} className="chip pr-1">
                            <button
                              type="button"
                              className="text-ink hover:text-rose"
                              onClick={() => onOpen(person.id)}
                            >
                              {person.full_name}
                            </button>
                            <button
                              type="button"
                              aria-label="Убрать связь"
                              className="px-1 text-muted hover:text-rose"
                              onClick={() => removeRelation(person.id, group.type)}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-6 flex gap-2">
              <button type="button" className="btn-primary flex-1" onClick={() => setEditing(true)}>
                Редактировать
              </button>
              <button type="button" className="btn-ghost" onClick={remove}>
                Удалить
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value) return null;
  return (
    <div className="flex gap-3">
      <dt className="w-32 flex-none text-[13px] text-muted">{label}</dt>
      <dd className="min-w-0 flex-1 whitespace-pre-wrap break-words text-ink">{value}</dd>
    </div>
  );
}
