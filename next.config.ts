import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Erzeugt einen eigenständigen Server samt der wirklich benötigten
  // node_modules – das hält das Container-Abbild klein.
  output: 'standalone',
  // Eine Kennung je Build. Sie wird beim Bauen in Seite und Server
  // eingesetzt; weicht die des Servers von der der offenen Seite ab, ist neu
  // ausgeliefert worden (`UpdateBanner`).
  env: {
    NEXT_PUBLIC_BUILD_ID: process.env.BUILD_ID ?? new Date().toISOString(),
  },
};

export default nextConfig;
