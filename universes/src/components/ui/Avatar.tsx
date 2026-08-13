'use client';

import { useSignedUrl } from '@/lib/media';
import type { Profile } from '@/lib/types';

interface Props {
  profile?: Profile | null;
  size?: number;
}

export default function Avatar({ profile, size = 40 }: Props) {
  const url = useSignedUrl('avatars', profile?.avatar_path);
  const accent = profile?.slug === 'eroma' ? 'bg-sage/20 text-sage' : 'bg-rose/20 text-rose';
  const letter = (profile?.display_name ?? '?').trim().charAt(0).toUpperCase();

  return (
    <span
      className={`flex flex-none items-center justify-center overflow-hidden rounded-full font-display ${accent}`}
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      aria-hidden
    >
      {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : letter}
    </span>
  );
}
