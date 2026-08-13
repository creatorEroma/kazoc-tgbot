import { Suspense } from 'react';
import LoginForm from '@/components/auth/LoginForm';

export const metadata = { title: 'Вход — Вселенные' };

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-5 py-12">
      <div className="w-full max-w-sm animate-fade-up">
        <div className="mb-8 text-center">
          <p className="mb-3 text-2xl text-rose">♥</p>
          <h1 className="font-display text-[28px] leading-tight text-ink">
            Вселенные Наргуль и Ернура
          </h1>
          <p className="mt-2 text-sm text-muted">
            Здесь только вы двое. Больше сюда никто не войдёт.
          </p>
        </div>

        <Suspense fallback={<div className="card h-64 animate-pulse-soft" />}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
