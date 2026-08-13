export type UniverseSlug = 'nako' | 'eroma';

export interface UniverseMeta {
  slug: UniverseSlug;
  name: string;
  title: string;
  possessive: string;
  accent: 'rose' | 'sage';
}

export const UNIVERSES: Record<UniverseSlug, UniverseMeta> = {
  nako: {
    slug: 'nako',
    name: 'Наргуль',
    title: 'ВСЕЛЕННАЯ НАРГУЛЬ',
    possessive: 'Наргуль',
    accent: 'rose',
  },
  eroma: {
    slug: 'eroma',
    name: 'Ернур',
    title: 'ВСЕЛЕННАЯ ЕРНУР',
    possessive: 'Ернура',
    accent: 'sage',
  },
};

export const UNIVERSE_LIST: UniverseMeta[] = [UNIVERSES.nako, UNIVERSES.eroma];

export function isUniverse(value: string): value is UniverseSlug {
  return value === 'nako' || value === 'eroma';
}

export const BOARD_KINDS = {
  dream: { key: 'dream', title: 'Мечты', single: 'Мечта', hint: 'То, что однажды сбудется' },
  plan: { key: 'plan', title: 'Планы', single: 'План', hint: 'Что делаем в ближайшее время' },
  gestalt: { key: 'gestalt', title: 'Гештальты', single: 'Гештальт', hint: 'То, что нужно закрыть' },
  wish: { key: 'wish', title: 'Wish-лист', single: 'Желание', hint: 'Хочу вот это' },
} as const;

export type BoardKind = keyof typeof BOARD_KINDS;

export const BOARD_KIND_LIST = Object.values(BOARD_KINDS);

/** Русские адреса разделов: /u/nako/spisok/mechty вместо /dream. */
export const KIND_BY_PATH: Record<string, BoardKind> = {
  mechty: 'dream',
  plany: 'plan',
  geshtalty: 'gestalt',
  wish: 'wish',
};

export const PATH_BY_KIND: Record<BoardKind, string> = {
  dream: 'mechty',
  plan: 'plany',
  gestalt: 'geshtalty',
  wish: 'wish',
};

export const STATUS_LABELS = {
  idea: 'В планах',
  in_progress: 'В процессе',
  done: 'Исполнено',
} as const;

export const PRIORITY_LABELS = {
  1: 'Когда-нибудь',
  2: 'Обычный',
  3: 'Очень хочу',
} as const;

export const RELATION_LABELS = {
  parent: 'Родитель',
  child: 'Ребёнок',
  spouse: 'Супруг(а)',
  sibling: 'Брат/сестра',
  other: 'Другая связь',
} as const;

export type RelationType = keyof typeof RELATION_LABELS;
