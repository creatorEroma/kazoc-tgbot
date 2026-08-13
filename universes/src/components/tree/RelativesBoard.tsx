'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useSignedUrl } from '@/lib/media';
import { withCount } from '@/lib/format';
import type { UniverseSlug } from '@/lib/constants';
import type { Relative, RelativeRelation } from '@/lib/types';
import RelativeForm from './RelativeForm';
import RelativeModal from './RelativeModal';

interface Props {
  universe: UniverseSlug;
  userSlug: string;
}

/**
 * Карта родственников. Поколения считаются из связей «родитель», а не
 * задаются руками: добавили одну связь — человек сам встал на свой уровень.
 */
export default function RelativesBoard({ universe, userSlug }: Props) {
  const [people, setPeople] = useState<Relative[]>([]);
  const [relations, setRelations] = useState<RelativeRelation[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const supabase = supabaseBrowser();
    const [{ data: relatives }, { data: links }] = await Promise.all([
      supabase.from('relatives').select('*').eq('universe', universe).order('full_name'),
      supabase.from('relative_relations').select('*'),
    ]);

    setPeople((relatives ?? []) as Relative[]);
    setRelations((links ?? []) as RelativeRelation[]);
    setLoading(false);
  }, [universe]);

  useEffect(() => {
    void load();
  }, [load]);

  // Второй пользователь правит древо параллельно — подхватываем изменения.
  useEffect(() => {
    const supabase = supabaseBrowser();
    const channel = supabase
      .channel(`tree-${universe}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'relatives' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'relative_relations' }, () =>
        void load(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load, universe]);

  const generations = useMemo(() => buildGenerations(people, relations), [people, relations]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return null;
    return people.filter(
      (person) =>
        person.full_name.toLowerCase().includes(query) ||
        (person.kinship ?? '').toLowerCase().includes(query) ||
        (person.city ?? '').toLowerCase().includes(query),
    );
  }, [people, search]);

  const open = people.find((person) => person.id === openId) ?? null;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          className="field flex-1 min-w-[180px]"
          placeholder="Поиск по имени, родству или городу"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button type="button" className="btn-primary" onClick={() => setAdding(true)}>
          + Человек
        </button>
      </div>

      {loading ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-20" />
          ))}
        </div>
      ) : people.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="font-display text-[18px] text-ink">Древо пока пустое</p>
          <p className="mx-auto mt-2 max-w-sm text-[14px] text-muted">
            Начните с себя или с родителей, а дальше добавляйте связи — поколения
            выстроятся сами.
          </p>
          <button type="button" className="btn-primary mt-4" onClick={() => setAdding(true)}>
            Добавить первого
          </button>
        </div>
      ) : filtered ? (
        <Section
          title={`Найдено: ${withCount(filtered.length, 'человек', 'человека', 'человек')}`}
          people={filtered}
          onOpen={setOpenId}
        />
      ) : (
        <div className="space-y-6">
          {generations.map((group, index) => (
            <Section
              key={index}
              title={generationTitle(index, generations.length)}
              people={group}
              onOpen={setOpenId}
            />
          ))}
        </div>
      )}

      {adding && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 backdrop-blur-sm sm:items-center sm:p-6"
          onClick={() => setAdding(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="max-h-[92dvh] w-full max-w-lg animate-fade-up overflow-y-auto rounded-t-card border border-line bg-surface p-5 shadow-lift sm:rounded-card"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 font-display text-[20px] text-ink">Новый человек</h2>
            <RelativeForm
              universe={universe}
              userSlug={userSlug}
              onSaved={(person) => {
                setPeople((prev) => [...prev, person]);
                setAdding(false);
                setOpenId(person.id);
              }}
              onCancel={() => setAdding(false)}
            />
          </div>
        </div>
      )}

      {open && (
        <RelativeModal
          relative={open}
          all={people}
          relations={relations}
          universe={universe}
          userSlug={userSlug}
          onClose={() => setOpenId(null)}
          onOpen={setOpenId}
          onSaved={(saved) =>
            setPeople((prev) => prev.map((person) => (person.id === saved.id ? saved : person)))
          }
          onDeleted={(id) => {
            setPeople((prev) => prev.filter((person) => person.id !== id));
            setOpenId(null);
          }}
          onRelationsChanged={load}
        />
      )}
    </div>
  );
}

function Section({
  title,
  people,
  onOpen,
}: {
  title: string;
  people: Relative[];
  onOpen: (id: string) => void;
}) {
  return (
    <section>
      <h2 className="mb-2 text-[12.5px] font-semibold uppercase tracking-[0.12em] text-muted">
        {title}
      </h2>
      <div className="grid gap-2 sm:grid-cols-2">
        {people.map((person) => (
          <PersonCard key={person.id} person={person} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}

function PersonCard({ person, onOpen }: { person: Relative; onOpen: (id: string) => void }) {
  const photo = useSignedUrl('media', person.photo_path);

  return (
    <button
      type="button"
      onClick={() => onOpen(person.id)}
      className="card flex items-center gap-3 p-3 text-left transition hover:shadow-lift"
    >
      {photo ? (
        <img src={photo} alt="" className="h-12 w-12 flex-none rounded-full object-cover" />
      ) : (
        <span className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-rose/15 font-display text-rose">
          {person.full_name.charAt(0)}
        </span>
      )}

      <span className="min-w-0">
        <span className="block truncate text-[15px] font-medium text-ink">{person.full_name}</span>
        <span className="block truncate text-[13px] text-muted">
          {[person.kinship, person.city].filter(Boolean).join(' · ') || 'Без описания'}
        </span>
      </span>
    </button>
  );
}

function generationTitle(index: number, total: number): string {
  if (total === 1) return 'Все родные';
  if (index === 0) return 'Старшее поколение';
  if (index === total - 1) return 'Младшее поколение';
  return `Поколение ${index + 1}`;
}

/** Раскладываем людей по поколениям: у кого нет родителей — верхний ряд,
 *  дальше вниз по связям. Супруги подтягиваются на один уровень. */
function buildGenerations(people: Relative[], relations: RelativeRelation[]): Relative[][] {
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  const spouses = new Map<string, string[]>();

  relations.forEach((relation) => {
    if (relation.type === 'parent') {
      parents.set(relation.from_id, [...(parents.get(relation.from_id) ?? []), relation.to_id]);
      children.set(relation.to_id, [...(children.get(relation.to_id) ?? []), relation.from_id]);
    }
    if (relation.type === 'spouse') {
      spouses.set(relation.from_id, [...(spouses.get(relation.from_id) ?? []), relation.to_id]);
    }
  });

  const ids = new Set(people.map((person) => person.id));
  const level = new Map<string, number>();
  const queue: string[] = [];

  people.forEach((person) => {
    const hasParent = (parents.get(person.id) ?? []).some((id) => ids.has(id));
    if (!hasParent) {
      level.set(person.id, 0);
      queue.push(person.id);
    }
  });

  // Если связи замкнулись в кольцо, стартуем с первого попавшегося.
  if (queue.length === 0 && people.length > 0) {
    level.set(people[0].id, 0);
    queue.push(people[0].id);
  }

  while (queue.length > 0) {
    const id = queue.shift()!;
    const current = level.get(id) ?? 0;

    (children.get(id) ?? []).forEach((childId) => {
      if (!ids.has(childId)) return;
      const next = current + 1;
      if (!level.has(childId) || level.get(childId)! < next) {
        level.set(childId, next);
        queue.push(childId);
      }
    });

    (spouses.get(id) ?? []).forEach((spouseId) => {
      if (!ids.has(spouseId) || level.has(spouseId)) return;
      level.set(spouseId, current);
      queue.push(spouseId);
    });
  }

  const maxLevel = Math.max(0, ...Array.from(level.values()));
  const buckets: Relative[][] = Array.from({ length: maxLevel + 1 }, () => []);
  people.forEach((person) => buckets[level.get(person.id) ?? 0].push(person));

  return buckets.filter((bucket) => bucket.length > 0);
}
