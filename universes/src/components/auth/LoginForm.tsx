'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

const allowed = (process.env.NEXT_PUBLIC_ALLOWED_EMAILS ?? '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export default function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const normalized = email.trim().toLowerCase();
    if (allowed.length > 0 && !allowed.includes(normalized)) {
      setError('Эта почта не входит в число двух разрешённых.');
      return;
    }

    setBusy(true);
    const supabase = supabaseBrowser();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: normalized,
      password,
    });
    setBusy(false);

    if (signInError) {
      setError(
        signInError.message.toLowerCase().includes('invalid')
          ? 'Неверная почта или пароль.'
          : 'Не получилось войти. Попробуйте ещё раз.',
      );
      return;
    }

    const next = params.get('dalee');
    router.replace(next && next.startsWith('/') ? next : '/');
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-4 p-6">
      <div>
        <label className="label" htmlFor="email">Почта</label>
        <input
          id="email"
          type="email"
          className="field"
          placeholder="ваша почта"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>

      <div>
        <label className="label" htmlFor="password">Пароль</label>
        <input
          id="password"
          type="password"
          className="field"
          placeholder="пароль"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>

      {error && (
        <p className="rounded-soft bg-rose/10 px-3 py-2 text-[13px] text-rose">{error}</p>
      )}

      <button type="submit" className="btn-primary w-full" disabled={busy}>
        {busy ? 'Заходим…' : 'Войти'}
      </button>
    </form>
  );
}
