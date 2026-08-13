/** Форматирование строго по-русски: даты, склонения, размеры, деньги. */

const MONTHS_GENITIVE = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

/** plural(2, 'фото', 'фото', 'фотографий') → 'фото' */
export function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
}

export function withCount(n: number, one: string, few: string, many: string): string {
  return `${n} ${plural(n, one, few, many)}`;
}

const time = (d: Date) =>
  `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** «только что», «сегодня, 14:30», «вчера, 09:12», «5 августа, 14:30», «5 августа 2024». */
export function formatDateTime(input: string | Date): string {
  const d = typeof input === 'string' ? new Date(input) : input;
  const now = new Date();
  const diffMin = (now.getTime() - d.getTime()) / 60000;

  if (diffMin < 1) return 'только что';
  if (diffMin < 60) return `${withCount(Math.floor(diffMin), 'минуту', 'минуты', 'минут')} назад`;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (sameDay(d, now)) return `сегодня, ${time(d)}`;
  if (sameDay(d, yesterday)) return `вчера, ${time(d)}`;

  const day = `${d.getDate()} ${MONTHS_GENITIVE[d.getMonth()]}`;
  if (d.getFullYear() === now.getFullYear()) return `${day}, ${time(d)}`;
  return `${day} ${d.getFullYear()}`;
}

/** Дата без времени: «5 августа 1994». */
export function formatDate(input: string | Date | null | undefined): string {
  if (!input) return '';
  const d = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${MONTHS_GENITIVE[d.getMonth()]} ${d.getFullYear()}`;
}

/** Разделитель дней в чате: «Сегодня», «Вчера», «5 августа». */
export function formatDayLabel(input: string | Date): string {
  const d = typeof input === 'string' ? new Date(input) : input;
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (sameDay(d, now)) return 'Сегодня';
  if (sameDay(d, yesterday)) return 'Вчера';

  const day = `${d.getDate()} ${MONTHS_GENITIVE[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? day : `${day} ${d.getFullYear()}`;
}

/** «1,4 ГБ» — с запятой, как принято в русской типографике. */
export function formatBytes(bytes: number): string {
  if (!bytes) return '0 Б';
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** i;
  const text = i === 0 ? String(Math.round(value)) : value.toFixed(value < 10 ? 1 : 0);
  return `${text.replace('.', ',')} ${units[i]}`;
}

/** «1:05», «12:03», «1:02:33». */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function formatPrice(value: number | null | undefined, currency = 'KZT'): string {
  if (value === null || value === undefined) return '';
  try {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${new Intl.NumberFormat('ru-RU').format(value)} ${currency}`;
  }
}

/** Сколько минут осталось на редактирование сообщения (правило 30 минут). */
export const EDIT_WINDOW_MS = 30 * 60 * 1000;

export function editWindowLeft(createdAt: string | Date): number {
  const created = typeof createdAt === 'string' ? new Date(createdAt) : createdAt;
  return Math.max(0, created.getTime() + EDIT_WINDOW_MS - Date.now());
}

export function formatEditLeft(ms: number): string {
  const minutes = Math.ceil(ms / 60000);
  return `${withCount(minutes, 'минута', 'минуты', 'минут')}`;
}
