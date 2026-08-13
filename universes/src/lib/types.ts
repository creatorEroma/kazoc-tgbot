import type { BoardKind, RelationType, UniverseSlug } from './constants';

export interface Profile {
  id: string;
  slug: UniverseSlug;
  display_name: string;
  full_name: string;
  avatar_path: string | null;
}

export interface MediaItem {
  id: string;
  owner: string;
  bucket: string;
  path: string;
  mime: string;
  kind: 'image' | 'video' | 'audio' | 'file';
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  duration_sec: number | null;
  poster_path: string | null;
  waveform: number[] | null;
  post_id: string | null;
  message_id: string | null;
  album_id: string | null;
  relative_id: string | null;
  taken_at: string | null;
  created_at: string;
}

export interface Post {
  id: string;
  author: string;
  parent_id: string | null;
  root_id: string;
  path: string;
  depth: number;
  body: string | null;
  reply_count: number;
  thread_count: number;
  like_count: number;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  profiles?: Profile | null;
  media?: MediaItem[];
  liked_by_me?: boolean;
  /** Заполняется на клиенте, пока пост ещё летит на сервер. */
  pending?: boolean;
}

export interface Message {
  id: string;
  author: string;
  body: string | null;
  kind: 'text' | 'voice' | 'media';
  reply_to: string | null;
  read_at: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
  media?: MediaItem[];
  pending?: boolean;
}

export interface Relative {
  id: string;
  universe: UniverseSlug;
  full_name: string;
  kinship: string | null;
  birth_date: string | null;
  death_date: string | null;
  is_alive: boolean;
  phone: string | null;
  address: string | null;
  city: string | null;
  notes: string | null;
  photo_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface RelativeRelation {
  id: string;
  from_id: string;
  to_id: string;
  type: RelationType;
  note: string | null;
}

export interface BoardItem {
  id: string;
  kind: BoardKind;
  scope: 'personal' | 'shared';
  universe: UniverseSlug;
  owner: string;
  title: string;
  description: string | null;
  link: string | null;
  price: number | null;
  currency: string;
  priority: 1 | 2 | 3;
  status: 'idea' | 'in_progress' | 'done';
  due_date: string | null;
  cover_path: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface Album {
  id: string;
  title: string;
  scope: 'personal' | 'shared';
  universe: UniverseSlug | null;
  cover_path: string | null;
  created_by: string;
  created_at: string;
}

/** Состояние одной загрузки в интерфейсе загрузчика. */
export interface UploadTask {
  id: string;
  file: File;
  name: string;
  size: number;
  progress: number;
  uploaded: number;
  status: 'waiting' | 'uploading' | 'done' | 'error' | 'canceled';
  error?: string;
  previewUrl?: string;
  media?: MediaItem;
  abort?: () => void;
}
