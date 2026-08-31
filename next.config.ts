import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Erzeugt einen eigenständigen Server samt der wirklich benötigten
  // node_modules – das hält das Container-Abbild klein.
  output: 'standalone',
};

export default nextConfig;
