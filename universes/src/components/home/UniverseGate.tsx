'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import type { UniverseMeta, UniverseSlug } from '@/lib/constants';
import ThemeToggle from '@/components/ui/ThemeToggle';

interface Props {
  universes: UniverseMeta[];
  me: UniverseSlug;
}

export default function UniverseGate({ universes, me }: Props) {
  return (
    <section className="relative flex flex-1 flex-col md:flex-row">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between p-5">
        <p className="font-display text-sm text-muted">Две вселенные, одна орбита</p>
        <div className="pointer-events-auto">
          <ThemeToggle />
        </div>
      </div>

      {universes.map((universe, index) => {
        const isMine = universe.slug === me;
        const accent = universe.accent === 'rose' ? 'text-rose' : 'text-sage';
        const glow =
          universe.accent === 'rose'
            ? 'from-rose/[0.14] via-transparent'
            : 'from-sage/[0.13] via-transparent';

        return (
          <motion.div
            key={universe.slug}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: index * 0.08, ease: [0.22, 0.8, 0.36, 1] }}
            className="group relative flex-1 border-line md:[&:not(:last-child)]:border-r [&:not(:last-child)]:border-b md:[&:not(:last-child)]:border-b-0"
          >
            <Link
              href={`/u/${universe.slug}`}
              className="relative flex h-full min-h-[42dvh] flex-col items-center justify-center gap-3 px-6 py-14 text-center transition-colors md:min-h-[calc(100dvh-84px)]"
            >
              <span
                className={`pointer-events-none absolute inset-0 bg-gradient-to-b ${glow} to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100`}
                aria-hidden
              />

              <span className={`relative text-2xl transition-transform duration-500 group-hover:scale-110 ${accent}`}>
                {universe.accent === 'rose' ? '✿' : '❋'}
              </span>

              <h2 className="relative font-display text-[30px] leading-[1.15] tracking-tight text-ink sm:text-[38px] md:text-[44px]">
                {universe.title}
              </h2>

              <p className="relative text-sm text-muted">
                {isMine ? 'Ваше пространство' : `Пространство ${universe.possessive}`}
              </p>

              <span
                className={`relative mt-2 text-[13px] font-medium opacity-0 transition-all duration-300 group-hover:opacity-100 ${accent}`}
              >
                Открыть →
              </span>
            </Link>
          </motion.div>
        );
      })}
    </section>
  );
}
