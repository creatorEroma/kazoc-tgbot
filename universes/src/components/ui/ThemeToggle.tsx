'use client';

import { useEffect, useState } from 'react';

export default function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('theme', next ? 'dark' : 'light');
    } catch {
      // приватный режим — просто не запоминаем выбор
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="btn-quiet px-3 py-1.5 text-[13px]"
      aria-label={dark ? 'Включить светлую тему' : 'Включить тёмную тему'}
    >
      {dark ? 'Светлая' : 'Тёмная'}
    </button>
  );
}
