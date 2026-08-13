-- ============================================================================
-- Привязка двух аккаунтов к вселенным.
--
-- Как применять:
--   1. Supabase Dashboard → Authentication → Users → Add user.
--      Создай ровно двух пользователей с паролями (Auto Confirm User — включить).
--   2. Скопируй их UUID из колонки User UID.
--   3. Подставь UUID ниже и выполни файл в SQL Editor.
--
-- Повторный запуск безопасен: профили обновятся, а не задвоятся.
-- ============================================================================

insert into public.profiles (id, slug, display_name, full_name)
values
  ('00000000-0000-0000-0000-000000000001', 'nako',  'Наргуль', 'Наргуль'),
  ('00000000-0000-0000-0000-000000000002', 'eroma', 'Ернур',   'Ернур')
on conflict (id) do update
  set slug = excluded.slug,
      display_name = excluded.display_name,
      full_name = excluded.full_name;

-- Проверка: должно вернуться ровно две строки.
select id, slug, display_name from public.profiles order by slug;
