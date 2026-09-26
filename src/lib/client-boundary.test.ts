import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Die Registry zieht alle Adapter samt cheerio nach sich und gehört nur auf
 * den Server. `import 'server-only'` scheidet aus, weil Tests und Skripte sie
 * direkt unter Node laden – deshalb prüft dieser Test die Importe selbst: kein
 * Client-Modul darf die Registry oder einen Adapter erreichen, auch nicht
 * über Umwege.
 */

const SRC = path.resolve(import.meta.dirname, '..');
const FORBIDDEN = [
  path.join(SRC, 'lib/events/registry.ts'),
  path.join(SRC, 'lib/events/sources') + path.sep,
];

test('kein Client-Modul erreicht die Registry', () => {
  const clientFiles = files(SRC).filter((file) => /^\s*['"]use client['"]/.test(read(file)));
  assert.ok(clientFiles.length > 0, 'Client-Module gefunden');

  for (const entry of clientFiles) {
    const chain = findForbidden(entry);
    assert.equal(chain, undefined, `Client-Modul lädt Serverteile: ${chain?.map(relative).join(' → ')}`);
  }
});

function findForbidden(entry: string): string[] | undefined {
  const seen = new Set<string>();
  const walk = (file: string, chain: string[]): string[] | undefined => {
    if (FORBIDDEN.some((forbidden) => file === forbidden || file.startsWith(forbidden))) return chain;
    if (seen.has(file)) return undefined;
    seen.add(file);
    for (const target of localImports(file)) {
      const found = walk(target, [...chain, target]);
      if (found) return found;
    }
    return undefined;
  };
  return walk(entry, [entry]);
}

function localImports(file: string): string[] {
  const source = read(file);
  const specifiers = [...source.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?!type\b)[^'"]*?from\s+['"]([^'"]+)['"]/g)]
    .map((match) => match[1]);
  return specifiers.flatMap((specifier) => {
    const base = specifier.startsWith('@/')
      ? path.join(SRC, specifier.slice(2))
      : specifier.startsWith('.')
        ? path.resolve(path.dirname(file), specifier)
        : undefined;
    const resolved = base && resolve(base);
    return resolved ? [resolved] : [];
  });
}

function resolve(base: string): string | undefined {
  const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
}

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__fixtures__' ? [] : files(full);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts') ? [full] : [];
  });
}

function read(file: string): string {
  return readFileSync(file, 'utf8');
}

function relative(file: string): string {
  return path.relative(SRC, file);
}
