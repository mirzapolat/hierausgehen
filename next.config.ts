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
  // Das Embedding-Modell der Suche läuft über native Bibliotheken
  // (onnxruntime-node). Gebündelt würden die nicht gefunden; sie bleiben
  // gewöhnliche Node-Module.
  serverExternalPackages: ['@huggingface/transformers', 'onnxruntime-node', 'onnxruntime-common', 'sharp'],
  // Die nativen Dateien lädt onnxruntime über einen errechneten Pfad – die
  // Spurensuche des Standalone-Builds sieht sie nicht von selbst. Der
  // Standalone-Server läuft nur im Linux-Container: macOS und Windows
  // (gut 220 MB) bleiben draussen.
  outputFileTracingIncludes: {
    '/**': ['./node_modules/onnxruntime-node/bin/napi-v6/linux/**/*', './node_modules/onnxruntime-common/**/*'],
  },
  outputFileTracingExcludes: {
    '/**': ['./node_modules/onnxruntime-node/bin/napi-v6/darwin/**/*', './node_modules/onnxruntime-node/bin/napi-v6/win32/**/*'],
  },
};

export default nextConfig;
