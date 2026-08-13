-- ============================================================================
-- Storage: приватные бакеты под тяжёлые фото/видео, голосовые и аватары.
--
-- ВАЖНО про размер файлов:
--   file_size_limit = null снимает лимит на уровне бакета, но остаётся
--   глобальный лимит проекта. Его нужно поднять руками:
--   Supabase Dashboard → Storage → Settings → Upload file size limit.
--   На бесплатном тарифе потолок 50 МБ, на Pro — до 50 ГБ.
--   Тяжёлые файлы всегда грузятся резюмируемой (TUS) загрузкой по частям.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('media',   'media',   false, null, null),
  ('voice',   'voice',   false, null, array['audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/wav']),
  ('avatars', 'avatars', false, null, array['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Доступ к файлам — только двум участникам whitelist.
drop policy if exists "Участники читают файлы" on storage.objects;
create policy "Участники читают файлы" on storage.objects
  for select using (
    bucket_id in ('media', 'voice', 'avatars') and public.is_member()
  );

drop policy if exists "Участники загружают файлы" on storage.objects;
create policy "Участники загружают файлы" on storage.objects
  for insert with check (
    bucket_id in ('media', 'voice', 'avatars') and public.is_member()
  );

drop policy if exists "Участники обновляют файлы" on storage.objects;
create policy "Участники обновляют файлы" on storage.objects
  for update using (
    bucket_id in ('media', 'voice', 'avatars') and public.is_member()
  ) with check (
    bucket_id in ('media', 'voice', 'avatars') and public.is_member()
  );

-- Удалять файл может только тот, кто его загрузил.
drop policy if exists "Автор удаляет свои файлы" on storage.objects;
create policy "Автор удаляет свои файлы" on storage.objects
  for delete using (
    bucket_id in ('media', 'voice', 'avatars') and owner = auth.uid()
  );
