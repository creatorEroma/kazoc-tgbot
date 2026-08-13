import { redirect } from 'next/navigation';
import PageHeader from '@/components/ui/PageHeader';
import GalleryScreen from '@/components/gallery/GalleryScreen';
import { currentProfile } from '@/lib/supabase/server';
import type { Profile } from '@/lib/types';

export const metadata = { title: 'Галерея' };
export const dynamic = 'force-dynamic';

export default async function GalleryPage() {
  const me = await currentProfile();
  if (!me) redirect('/vhod');

  return (
    <main className="min-h-dvh pb-20">
      <PageHeader title="Галерея" subtitle="Фото и видео в облаке" />
      <div className="mx-auto max-w-3xl px-4 py-5">
        <GalleryScreen me={me as Profile} />
      </div>
    </main>
  );
}
