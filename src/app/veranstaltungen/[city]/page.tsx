import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cities, cityById, isKnownCityId } from '@/lib/cities';
import { getSnapshot } from '@/lib/events/snapshot';
import { todayInZone } from '@/lib/events/schedule';
import { SITE_NAME, SITE_URL, cityMetadata, programmePath } from '@/lib/site';
import { StructuredData } from '@/components/StructuredData';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ city: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { city } = await params;
  if (!isKnownCityId(city)) notFound();
  const { description } = cityMetadata(city);
  const title = `Veranstaltungen in ${cityById(city).name} – kommende Termine`;
  const url = new URL(programmePath(city), SITE_URL).toString();
  return {
    title, description, alternates: { canonical: url },
    openGraph: { type: 'website', locale: 'de_DE', siteName: SITE_NAME, title, description, url },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function ProgrammePage({ params }: Props) {
  const { city: cityId } = await params;
  if (!isKnownCityId(cityId)) notFound();
  const city = cityById(cityId);
  const data = await getSnapshot(cityId);
  // Request-time clock in a dynamic server component, as in StructuredData.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const today = todayInZone(city.timeZone);
  const events = data.events
    .filter((event) => event.allDay ? event.start.slice(0, 10) >= today : Date.parse(event.start) >= now)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
    .slice(0, 60);
  const date = new Intl.DateTimeFormat('de-DE', { dateStyle: 'full', timeZone: city.timeZone });
  const time = new Intl.DateTimeFormat('de-DE', { timeStyle: 'short', timeZone: city.timeZone });
  const availability = { available: 'Tickets verfügbar', limited: 'Restkarten', soldout: 'Ausverkauft', not_on_sale: 'Derzeit kein Vorverkauf', unknown: 'Ticketlage bitte bei der Quelle prüfen' };

  return (
    <main className="h-full overflow-y-auto bg-[var(--canvas)] px-6 py-10 text-text">
      <div className="mx-auto max-w-3xl">
        <nav aria-label="Städte" className="flex flex-wrap gap-5 text-sm text-muted">
          {cities.map((item) => <Link key={item.id} href={programmePath(item.id)} prefetch={false} aria-current={item.id === cityId ? 'page' : undefined}>{item.name}</Link>)}
          <Link href="/impressum">Impressum</Link>
        </nav>
        <h1 className="mt-8 text-3xl font-semibold">Veranstaltungen in {city.name}</h1>
        <p className="mt-4 leading-relaxed">{cityMetadata(cityId).description}</p>
        <p className="mt-3 text-sm leading-relaxed text-muted">Hier ausgehen bündelt die Programme der unten genannten Häuser. Die Quellen werden täglich abgerufen; bei Ausfällen kann der letzte verfügbare Stand angezeigt werden. Verbindliche Angaben zu Beginn, Änderungen und Tickets findest du auf der verlinkten Originalseite. Alle Uhrzeiten gelten vor Ort in {city.name}.</p>
        <Link href={`/?city=${cityId}`} className="mt-5 inline-block rounded border border-line px-4 py-2 text-sm">Kalender öffnen und nach Datum oder Veranstaltungsart filtern</Link>
        <h2 className="mt-10 text-xl font-semibold">Kommende Termine</h2>
        <p className="mt-2 text-sm text-muted">Die nächsten bis zu 60 Termine aus unserem Datenstand. Weitere Termine findest du im Kalender.</p>
        {events.length === 0 && <p className="mt-6">Aktuell liegen keine kommenden Termine vor. Die Programme der Häuser sind unten direkt verlinkt.</p>}
        <ol className="mt-5 divide-y divide-[var(--line)]">
          {events.map((event) => (
            <li key={event.id} className="py-5">
              <article>
                <h3 className="text-lg font-medium"><a href={event.url} className="hover:underline">{event.title}</a></h3>
                <p className="mt-1 text-sm"><time dateTime={event.allDay ? event.start.slice(0, 10) : event.start}>{date.format(new Date(event.start))}{event.allDay ? ' · Uhrzeit bei der Quelle' : ` · ${time.format(new Date(event.start))}`}</time></p>
                <p className="mt-1 text-sm text-muted">{event.venue.name} · {event.venue.city ?? city.name}{event.category ? ` · ${event.category}` : ''}</p>
                {event.subtitle && <p className="mt-2">{event.subtitle}</p>}
                {event.description && <p className="mt-2 whitespace-pre-line text-sm leading-relaxed">{event.description}</p>}
                <p className="mt-2 text-sm text-muted">{event.availabilityLabel ?? availability[event.availability]}</p>
                <div className="mt-3 flex gap-5 text-sm underline">
                  <a href={event.url}>Programm bei {data.definitions.find((source) => source.id === event.sourceId)?.name ?? 'der Quelle'}</a>
                  {event.ticketUrl && <a href={event.ticketUrl}>Tickets beim Anbieter</a>}
                </div>
              </article>
            </li>
          ))}
        </ol>
        <section className="mt-10 border-t border-line pt-6">
          <h2 className="text-xl font-semibold">Quellen und Spielpläne in {city.name}</h2>
          <ul className="mt-4 space-y-2 text-sm">
            {data.definitions.map((source) => <li key={source.id}><a href={source.homepage} className="underline">{source.name}</a></li>)}
          </ul>
          <Link href={`/status?city=${cityId}`} className="mt-5 inline-block text-sm underline">Datenstand und Quellenstatus prüfen</Link>
        </section>
        <StructuredData cityId={cityId} events={events} definitions={data.definitions} pageUrl={new URL(programmePath(cityId), SITE_URL).toString()} />
      </div>
    </main>
  );
}
