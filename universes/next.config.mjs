/** @type {import('next').NextConfig} */
const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : undefined;

const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: supabaseHost
      ? [{ protocol: 'https', hostname: supabaseHost, pathname: '/storage/v1/**' }]
      : [],
  },
  experimental: {
    // Тяжёлые файлы уходят напрямую в Supabase Storage, минуя сервер Next.js,
    // поэтому лимит боди server actions нужен только для мелких форм.
    serverActions: { bodySizeLimit: '2mb' },
  },
};

export default nextConfig;
