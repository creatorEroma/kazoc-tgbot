-- ============================================================================
-- ВСЕЛЕННЫЕ НАРГУЛЬ И ЕРНУРА — схема базы данных
-- Этап 1: таблицы, связи, индексы, триггеры, Row Level Security
--
-- Пользователей ровно двое:
--   nako  — Наргуль (девушка)
--   eroma — Ернур (парень)
-- Оба имеют абсолютно равные права на все общие данные.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Перечисления
-- ---------------------------------------------------------------------------
do $$ begin
  create type universe_slug as enum ('nako', 'eroma');
exception when duplicate_object then null; end $$;

do $$ begin
  create type board_kind as enum ('dream', 'plan', 'gestalt', 'wish');
exception when duplicate_object then null; end $$;

do $$ begin
  create type board_scope as enum ('personal', 'shared');
exception when duplicate_object then null; end $$;

do $$ begin
  create type item_status as enum ('idea', 'in_progress', 'done');
exception when duplicate_object then null; end $$;

do $$ begin
  create type relation_type as enum ('parent', 'child', 'spouse', 'sibling', 'other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type media_kind as enum ('image', 'video', 'audio', 'file');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Профили. Строк может быть максимум две — это и есть whitelist доступа.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  slug          universe_slug unique not null,
  display_name  text not null,
  full_name     text not null,
  avatar_path   text,
  created_at    timestamptz not null default now()
);

comment on table public.profiles is 'Ровно два аккаунта: Наргуль (nako) и Ернур (eroma).';

create or replace function public.limit_profiles()
returns trigger language plpgsql as $$
begin
  if (select count(*) from public.profiles) >= 2 then
    raise exception 'В системе может быть только два аккаунта';
  end if;
  return new;
end $$;

drop trigger if exists trg_limit_profiles on public.profiles;
create trigger trg_limit_profiles
  before insert on public.profiles
  for each row execute function public.limit_profiles();

-- Главный предикат безопасности: пользователь входит в whitelist.
create or replace function public.is_member()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid());
$$;

-- Ярлык вселенной текущего пользователя.
create or replace function public.my_slug()
returns universe_slug
language sql stable security definer set search_path = public as $$
  select p.slug from public.profiles p where p.id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Генеалогическое древо: люди + отдельная таблица связей.
-- Связи хранятся реляционно, чтобы не путаться в ветках.
-- ---------------------------------------------------------------------------
create table if not exists public.relatives (
  id          uuid primary key default gen_random_uuid(),
  universe    universe_slug not null,
  full_name   text not null,
  kinship     text,
  birth_date  date,
  death_date  date,
  is_alive    boolean not null default true,
  phone       text,
  address     text,
  city        text,
  notes       text,
  photo_path  text,
  created_by  uuid references public.profiles (id),
  updated_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists relatives_universe_idx on public.relatives (universe, full_name);

create table if not exists public.relative_relations (
  id         uuid primary key default gen_random_uuid(),
  from_id    uuid not null references public.relatives (id) on delete cascade,
  to_id      uuid not null references public.relatives (id) on delete cascade,
  type       relation_type not null,
  note       text,
  created_at timestamptz not null default now(),
  constraint relative_relations_unique unique (from_id, to_id, type),
  constraint relative_relations_no_self check (from_id <> to_id)
);

create index if not exists relative_relations_from_idx on public.relative_relations (from_id);
create index if not exists relative_relations_to_idx on public.relative_relations (to_id);

-- Обратная связь создаётся автоматически: родитель ↔ ребёнок, супруги и
-- братья/сёстры симметричны. Так ветки древа никогда не расходятся.
create or replace function public.sync_inverse_relation()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  inverse relation_type;
begin
  inverse := case new.type
    when 'parent'  then 'child'::relation_type
    when 'child'   then 'parent'::relation_type
    when 'spouse'  then 'spouse'::relation_type
    when 'sibling' then 'sibling'::relation_type
    else null
  end;

  if inverse is not null then
    insert into public.relative_relations (from_id, to_id, type)
    values (new.to_id, new.from_id, inverse)
    on conflict (from_id, to_id, type) do nothing;
  end if;

  return new;
end $$;

drop trigger if exists trg_sync_inverse_relation on public.relative_relations;
create trigger trg_sync_inverse_relation
  after insert on public.relative_relations
  for each row execute function public.sync_inverse_relation();

create or replace function public.delete_inverse_relation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.relative_relations
   where from_id = old.to_id
     and to_id = old.from_id
     and type = case old.type
       when 'parent'  then 'child'::relation_type
       when 'child'   then 'parent'::relation_type
       when 'spouse'  then 'spouse'::relation_type
       when 'sibling' then 'sibling'::relation_type
       else old.type
     end;
  return old;
end $$;

drop trigger if exists trg_delete_inverse_relation on public.relative_relations;
create trigger trg_delete_inverse_relation
  after delete on public.relative_relations
  for each row execute function public.delete_inverse_relation();

-- ---------------------------------------------------------------------------
-- Дашборды: Мечты, Планы, Гештальты, Wish-листы.
-- scope = personal — видит только владелец; scope = shared — видят оба.
-- ---------------------------------------------------------------------------
create table if not exists public.board_items (
  id          uuid primary key default gen_random_uuid(),
  kind        board_kind not null,
  scope       board_scope not null default 'personal',
  universe    universe_slug not null,
  owner       uuid not null references public.profiles (id) on delete cascade,
  title       text not null,
  description text,
  link        text,
  price       numeric(12, 2),
  currency    text not null default 'KZT',
  priority    smallint not null default 2 check (priority between 1 and 3),
  status      item_status not null default 'idea',
  due_date    date,
  cover_path  text,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists board_items_lookup_idx
  on public.board_items (kind, scope, universe, created_at desc);

-- ---------------------------------------------------------------------------
-- «Поэтика»: посты и комментарии живут в одной таблице.
-- Комментарий — это тот же пост с parent_id, поэтому вложенность бесконечна
-- по определению, а вся ветка достаётся одним запросом по префиксу path.
-- ---------------------------------------------------------------------------
create table if not exists public.posts (
  id           uuid primary key default gen_random_uuid(),
  author       uuid not null references public.profiles (id) on delete cascade,
  parent_id    uuid references public.posts (id) on delete cascade,
  root_id      uuid references public.posts (id) on delete cascade,
  path         text not null default '',
  depth        integer not null default 0,
  body         text,
  reply_count  integer not null default 0,
  thread_count integer not null default 0,
  like_count   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  edited_at    timestamptz,
  deleted_at   timestamptz
);

create index if not exists posts_roots_idx
  on public.posts (created_at desc) where parent_id is null;
create index if not exists posts_thread_idx
  on public.posts (root_id, created_at);
create index if not exists posts_parent_idx
  on public.posts (parent_id, created_at);
create index if not exists posts_path_idx
  on public.posts (path text_pattern_ops);

-- path вида '/<root>/<child>/<grandchild>/' — префиксный поиск достаёт ветку.
create or replace function public.posts_set_tree_fields()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  parent_path  text;
  parent_depth integer;
  parent_root  uuid;
begin
  if new.parent_id is null then
    new.root_id := new.id;
    new.depth   := 0;
    new.path    := '/' || new.id::text || '/';
  else
    select p.path, p.depth, coalesce(p.root_id, p.id)
      into parent_path, parent_depth, parent_root
      from public.posts p
     where p.id = new.parent_id;

    if parent_path is null then
      raise exception 'Родительский пост не найден';
    end if;

    new.root_id := parent_root;
    new.depth   := parent_depth + 1;
    new.path    := parent_path || new.id::text || '/';
  end if;

  return new;
end $$;

drop trigger if exists trg_posts_set_tree_fields on public.posts;
create trigger trg_posts_set_tree_fields
  before insert on public.posts
  for each row execute function public.posts_set_tree_fields();

create or replace function public.posts_bump_counters()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.parent_id is not null then
    update public.posts set reply_count = reply_count + 1 where id = new.parent_id;
    update public.posts set thread_count = thread_count + 1 where id = new.root_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_posts_bump_counters on public.posts;
create trigger trg_posts_bump_counters
  after insert on public.posts
  for each row execute function public.posts_bump_counters();

create table if not exists public.post_likes (
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create or replace function public.posts_sync_likes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.posts set like_count = like_count + 1 where id = new.post_id;
    return new;
  else
    update public.posts set like_count = greatest(like_count - 1, 0) where id = old.post_id;
    return old;
  end if;
end $$;

drop trigger if exists trg_posts_sync_likes on public.post_likes;
create trigger trg_posts_sync_likes
  after insert or delete on public.post_likes
  for each row execute function public.posts_sync_likes();

-- ---------------------------------------------------------------------------
-- Мессенджер. Правило 30 минут живёт в базе, а не только в интерфейсе.
-- ---------------------------------------------------------------------------
create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  author     uuid not null references public.profiles (id) on delete cascade,
  body       text,
  kind       text not null default 'text' check (kind in ('text', 'voice', 'media')),
  reply_to   uuid references public.messages (id) on delete set null,
  read_at    timestamptz,
  edited_at  timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists messages_feed_idx on public.messages (created_at desc);

-- Окно редактирования — ровно 30 минут с момента отправки.
create or replace function public.enforce_message_rules()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Автора и время отправки менять нельзя никогда.
  if new.author <> old.author or new.created_at <> old.created_at then
    raise exception 'Автора и время сообщения изменить нельзя';
  end if;

  -- Текст правит только автор и только 30 минут.
  if new.body is distinct from old.body then
    if old.author <> auth.uid() then
      raise exception 'Редактировать можно только свои сообщения';
    end if;
    if old.created_at < now() - interval '30 minutes' then
      raise exception 'Редактирование доступно только 30 минут после отправки';
    end if;
    new.edited_at := now();
  end if;

  -- Удалить сообщение может только его автор.
  if new.deleted_at is distinct from old.deleted_at and old.author <> auth.uid() then
    raise exception 'Удалять можно только свои сообщения';
  end if;

  -- Отметку о прочтении ставит только собеседник.
  if new.read_at is distinct from old.read_at and old.author = auth.uid() then
    raise exception 'Отметку о прочтении ставит получатель';
  end if;

  return new;
end $$;

drop trigger if exists trg_enforce_message_rules on public.messages;
create trigger trg_enforce_message_rules
  before update on public.messages
  for each row execute function public.enforce_message_rules();

-- ---------------------------------------------------------------------------
-- Медиа и альбомы. Файл лежит в Storage, метаданные — здесь.
-- ---------------------------------------------------------------------------
create table if not exists public.albums (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  scope      board_scope not null default 'shared',
  universe   universe_slug,
  cover_path text,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.media (
  id           uuid primary key default gen_random_uuid(),
  owner        uuid not null references public.profiles (id) on delete cascade,
  bucket       text not null default 'media',
  path         text not null,
  mime         text not null,
  kind         media_kind not null,
  size_bytes   bigint,
  width        integer,
  height       integer,
  duration_sec numeric(10, 2),
  poster_path  text,
  waveform     jsonb,
  post_id      uuid references public.posts (id) on delete cascade,
  message_id   uuid references public.messages (id) on delete cascade,
  album_id     uuid references public.albums (id) on delete set null,
  relative_id  uuid references public.relatives (id) on delete cascade,
  taken_at     timestamptz,
  created_at   timestamptz not null default now(),
  constraint media_path_unique unique (bucket, path)
);

create index if not exists media_post_idx on public.media (post_id);
create index if not exists media_message_idx on public.media (message_id);
create index if not exists media_album_idx on public.media (album_id, taken_at desc);
create index if not exists media_gallery_idx on public.media (created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at обновляется автоматически везде, где он есть.
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['relatives', 'board_items', 'posts'] loop
    execute format('drop trigger if exists trg_touch_%1$s on public.%1$I', t);
    execute format(
      'create trigger trg_touch_%1$s before update on public.%1$I
         for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- Ни одна таблица не отдаёт ни строки тому, кого нет в profiles.
-- ---------------------------------------------------------------------------
alter table public.profiles           enable row level security;
alter table public.relatives          enable row level security;
alter table public.relative_relations enable row level security;
alter table public.board_items        enable row level security;
alter table public.posts              enable row level security;
alter table public.post_likes         enable row level security;
alter table public.messages           enable row level security;
alter table public.albums             enable row level security;
alter table public.media              enable row level security;

-- profiles: оба видят оба профиля, редактирует каждый только свой.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (public.is_member());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- Родственники и связи: общее достояние, равные root-права у обоих.
drop policy if exists relatives_all on public.relatives;
create policy relatives_all on public.relatives
  for all using (public.is_member()) with check (public.is_member());

drop policy if exists relative_relations_all on public.relative_relations;
create policy relative_relations_all on public.relative_relations
  for all using (public.is_member()) with check (public.is_member());

-- Дашборды: общее — обоим, личное — только владельцу.
drop policy if exists board_items_select on public.board_items;
create policy board_items_select on public.board_items
  for select using (
    public.is_member() and (scope = 'shared' or owner = auth.uid())
  );

drop policy if exists board_items_insert on public.board_items;
create policy board_items_insert on public.board_items
  for insert with check (
    public.is_member() and (scope = 'shared' or owner = auth.uid())
  );

drop policy if exists board_items_update on public.board_items;
create policy board_items_update on public.board_items
  for update using (
    public.is_member() and (scope = 'shared' or owner = auth.uid())
  ) with check (
    public.is_member() and (scope = 'shared' or owner = auth.uid())
  );

drop policy if exists board_items_delete on public.board_items;
create policy board_items_delete on public.board_items
  for delete using (
    public.is_member() and (scope = 'shared' or owner = auth.uid())
  );

-- Лента: читают оба, пишет каждый от своего имени, правит и удаляет только своё.
drop policy if exists posts_select on public.posts;
create policy posts_select on public.posts
  for select using (public.is_member());

drop policy if exists posts_insert on public.posts;
create policy posts_insert on public.posts
  for insert with check (public.is_member() and author = auth.uid());

-- Свой пост правит только автор. Счётчики ответов и лайков меняют триггеры,
-- они выполняются от владельца таблицы и через RLS не проходят.
drop policy if exists posts_update on public.posts;
create policy posts_update on public.posts
  for update using (author = auth.uid()) with check (author = auth.uid());

drop policy if exists posts_delete on public.posts;
create policy posts_delete on public.posts
  for delete using (author = auth.uid());

drop policy if exists post_likes_select on public.post_likes;
create policy post_likes_select on public.post_likes
  for select using (public.is_member());

drop policy if exists post_likes_insert on public.post_likes;
create policy post_likes_insert on public.post_likes
  for insert with check (public.is_member() and user_id = auth.uid());

drop policy if exists post_likes_delete on public.post_likes;
create policy post_likes_delete on public.post_likes
  for delete using (user_id = auth.uid());

-- Мессенджер: читают оба; правки ограничивает триггер enforce_message_rules.
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select using (public.is_member());

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert with check (public.is_member() and author = auth.uid());

drop policy if exists messages_update on public.messages;
create policy messages_update on public.messages
  for update using (public.is_member()) with check (public.is_member());

drop policy if exists messages_delete on public.messages;
create policy messages_delete on public.messages
  for delete using (author = auth.uid());

-- Альбомы и медиа.
drop policy if exists albums_all on public.albums;
create policy albums_all on public.albums
  for all using (public.is_member()) with check (public.is_member());

drop policy if exists media_select on public.media;
create policy media_select on public.media
  for select using (public.is_member());

drop policy if exists media_insert on public.media;
create policy media_insert on public.media
  for insert with check (public.is_member() and owner = auth.uid());

drop policy if exists media_update on public.media;
create policy media_update on public.media
  for update using (public.is_member()) with check (public.is_member());

drop policy if exists media_delete on public.media;
create policy media_delete on public.media
  for delete using (owner = auth.uid());

-- ---------------------------------------------------------------------------
-- Realtime: что именно транслируется подписчикам.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['messages', 'posts', 'board_items', 'relatives',
                           'relative_relations', 'media', 'post_likes'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- Полные строки в событиях UPDATE/DELETE — иначе Realtime отдаёт только id.
alter table public.messages    replica identity full;
alter table public.posts       replica identity full;
alter table public.board_items replica identity full;
