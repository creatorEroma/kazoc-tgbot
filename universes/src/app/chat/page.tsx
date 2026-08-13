import { redirect } from 'next/navigation';
import PageHeader from '@/components/ui/PageHeader';
import ChatScreen from '@/components/chat/ChatScreen';
import { currentProfile } from '@/lib/supabase/server';
import type { Profile } from '@/lib/types';

export const metadata = { title: 'Чат' };
export const dynamic = 'force-dynamic';

export default async function ChatPage() {
  const me = await currentProfile();
  if (!me) redirect('/vhod');

  return (
    <main className="min-h-dvh">
      <PageHeader title="Чат" subtitle="Изменить сообщение можно 30 минут" />
      <ChatScreen me={me as Profile} />
    </main>
  );
}
