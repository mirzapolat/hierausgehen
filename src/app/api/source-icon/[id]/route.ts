import { sourceById } from '@/lib/events/registry';
import { loadSourceIcon } from '@/lib/events/favicon';

/**
 * Liefert das Favicon einer Quelle über den eigenen Server aus. Damit lädt der
 * Browser der Besucher nichts von den Seiten der Veranstalter, und ein
 * fehlendes Icon bleibt ein sauberer 404 (die Sidebar zeigt dann den
 * Farbpunkt der Quelle).
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const source = sourceById.get(id);
  if (!source) return new Response('Unbekannte Quelle', { status: 404 });

  const icon = await loadSourceIcon(source.definition);
  if (!icon) return new Response('Kein Icon gefunden', { status: 404 });

  return new Response(Buffer.from(icon.data, 'base64'), {
    headers: {
      'Content-Type': icon.contentType,
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
    },
  });
}
