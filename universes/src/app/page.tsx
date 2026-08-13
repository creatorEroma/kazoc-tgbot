import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentProfile } from '@/lib/supabase/server';
import { UNIVERSE_LIST } from '@/lib/constants';
import UniverseGate from '@/components/home/UniverseGate';

export default async function HomePage() {
  const profile = await currentProfile();

  // Пользователь есть в auth, но не привязан к вселенной — значит, seed не применён.
  if (!profile) redirect('/vhod');

  return (
    <main className="flex min-h-dvh flex-col">
      <UniverseGate universes={UNIVERSE_LIST} me={profile.slug} />

      <nav className="border-t border-line bg-surface/70 px-5 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-2">
          <span className="mr-1 hidden text-[13px] text-muted sm:inline">Общее:</span>
          <Link href="/poetika" className="btn-ghost">Поэтика</Link>
          <Link href="/chat" className="btn-ghost">Чат</Link>
          <Link href="/galereya" className="btn-ghost">Галерея</Link>
          <Link href="/obshee/wish" className="btn-ghost">Общие списки</Link>
        </div>
      </nav>
    </main>
  );
}
