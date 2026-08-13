import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

type CookieList = { name: string; value: string; options?: CookieOptions }[];

/** Серверный клиент Supabase для Server Components, Route Handlers и Server Actions. */
export async function supabaseServer() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (list: CookieList) => {
          try {
            list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // В Server Component куки только читаются — обновит middleware.
          }
        },
      },
    },
  );
}

/** Профиль текущего пользователя или null, если он не из whitelist. */
export async function currentProfile() {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  const { data } = await supabase
    .from('profiles')
    .select('id, slug, display_name, full_name, avatar_path')
    .eq('id', auth.user.id)
    .maybeSingle();

  return data ?? null;
}
