'use client';

import Link from 'next/link';
import type { AggregateResult, SourceDefinition, SourceResult, SourceStatus } from '@/lib/events/types';
import { useSettings } from '@/lib/settings/context';
import { ChevronLeft, External, Warning } from './icons';
import { SourceIcon } from './SourceIcon';

interface Props {
  data: AggregateResult;
  range: { from: string; to: string };
  cityId: string;
  cityName: string;
}

export function StatusScreen({ data, range, cityId, cityName }: Props) {
  const { format, t } = useSettings();
  const statusById = new Map(data.sources.map((source) => [source.sourceId, source]));
  const rows = data.definitions
    .map((definition) => ({ definition, status: statusById.get(definition.id) }))
    .sort((a, b) => a.definition.name.localeCompare(b.definition.name, 'de'));
  const problems = rows.filter(({ status }) => status && isProblem(status.status));
  const totalEvents = rows.reduce((sum, row) => sum + (row.status?.eventCount ?? 0), 0);
  const newest = rows.reduce<string | undefined>(
    (acc, row) => {
      const fetchedAt = row.status?.fetchedAt;
      return fetchedAt && (!acc || fetchedAt > acc) ? fetchedAt : acc;
    },
    undefined,
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center gap-2 bg-[var(--chrome)] px-3 hairline-b">
        {/* Zurück in dieselbe Stadt, aus der man gekommen ist. */}
        <Link
          href={`/?city=${encodeURIComponent(cityId)}`}
          className="-ml-1 flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-1 text-[12px]
                     text-muted hover:text-text"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          {t('backToCalendar')}
        </Link>
        <h1 className="ml-2 text-[14px] font-semibold tracking-[-0.01em]">{t('status')}</h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto scroll-quiet">
        <main className="mx-auto w-full max-w-[760px] px-5 py-8">
          <section className="mb-8">
            <h2 className="mb-3 text-[11px] font-medium uppercase tracking-[0.06em] text-faint">
              {t('dataStatus')}
            </h2>
            <dl className="grid gap-3 sm:grid-cols-4">
              <SummaryItem label={t('statusSources')} value={String(rows.length)} />
              <SummaryItem label={t('statusEvents')} value={String(totalEvents)} />
              <SummaryItem label={t('statusProblems')} value={String(problems.length)} problem={problems.length > 0} />
              <SummaryItem
                label={t('statusLastFetch')}
                value={newest ? format.stamp(newest) : t('statusNoFetch')}
              />
            </dl>
            <p className="mt-3 text-[12px] text-faint">
              {cityName} · {t('statusCoverage')} {format.dayNoWeekday(range.from)} –{' '}
              {format.dayNoWeekday(range.to)}
            </p>
          </section>

          <section className="mb-8">
            <div
              className={`flex items-start gap-2 rounded-[var(--radius-md)] border px-3 py-2.5 ${
                problems.length
                  ? 'border-[color:var(--danger)]/40 bg-[var(--raised)] text-[var(--danger)]'
                  : 'border-line bg-[var(--raised)] text-muted'
              }`}
            >
              {problems.length > 0 && <Warning className="mt-[1px] h-4 w-4 shrink-0" />}
              <p className="text-[13px] leading-relaxed">
                {problems.length === 0 && t('statusNoProblems')}
                {problems.length === 1 && t('statusProblemOne')}
                {problems.length > 1 && t('statusProblemMany', { count: problems.length })}
              </p>
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-[11px] font-medium uppercase tracking-[0.06em] text-faint">
              {t('statusSources')}
            </h2>
            <ul className="flex flex-col">
              {rows.map(({ definition, status }) => (
                <SourceRow key={definition.id} definition={definition} status={status} />
              ))}
            </ul>
          </section>
        </main>
      </div>
    </div>
  );
}

function SummaryItem({ label, value, problem }: { label: string; value: string; problem?: boolean }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-line bg-[var(--raised)] px-3 py-2.5">
      <dt className="text-[11px] text-faint">{label}</dt>
      <dd className={`mt-1 text-[18px] font-semibold ${problem ? 'text-[var(--danger)]' : 'text-text'}`}>
        {value}
      </dd>
    </div>
  );
}

function SourceRow({
  definition,
  status,
}: {
  definition: SourceDefinition;
  status: SourceResult | undefined;
}) {
  const { format, t, term } = useSettings();
  const problem = status ? isProblem(status.status) : true;

  return (
    <li className="grid gap-2 py-3 hairline-b sm:grid-cols-[minmax(0,1fr)_112px_112px_132px] sm:items-center">
      <div className="flex min-w-0 items-center gap-2">
        <SourceIcon source={definition} size={16} />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[13px] font-medium text-text">{definition.name}</span>
            {problem && <Warning className="h-3.5 w-3.5 shrink-0 text-[var(--danger)]" />}
          </div>
          <div className="flex min-w-0 items-center gap-1.5 text-[12px] text-faint">
            <span className="truncate">{term(definition.group)}</span>
            <span aria-hidden="true">·</span>
            <a
              href={definition.homepage}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-w-0 items-center gap-1 hover:text-muted"
            >
              <span className="truncate">{new URL(definition.homepage).hostname.replace(/^www\./, '')}</span>
              <External className="h-3 w-3 shrink-0" />
            </a>
          </div>
        </div>
      </div>

      <RowMetric label={t('statusState')}>
        <span className={statusTone(status?.status)}>{t(statusKey(status?.status))}</span>
      </RowMetric>
      <RowMetric label={t('statusEvents')}>{status?.eventCount ?? 0}</RowMetric>
      <RowMetric label={t('statusLastFetch')}>
        {status?.fetchedAt ? format.stamp(status.fetchedAt) : t('statusNoFetch')}
      </RowMetric>

      {problem && status?.error && (
        <p className="text-[12px] leading-relaxed text-[var(--danger)] sm:col-span-4">{status.error}</p>
      )}
      {/* Erreichbar, aber ohne Termin – Saisonpause, keine Störung. */}
      {!problem && status?.eventCount === 0 && (
        <p className="text-[12px] leading-relaxed text-faint sm:col-span-4">{t('statusNoEvents')}</p>
      )}
    </li>
  );
}

function RowMetric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 sm:block">
      <span className="text-[11px] text-faint sm:hidden">{label}</span>
      <span className="text-[13px] text-text">{children}</span>
    </div>
  );
}

function isProblem(status: SourceStatus): boolean {
  return status === 'stale' || status === 'error';
}

function statusKey(status: SourceStatus | undefined) {
  if (status === 'ok') return 'statusOk';
  if (status === 'revalidating') return 'statusRevalidating';
  if (status === 'stale') return 'statusStale';
  return 'statusError';
}

function statusTone(status: SourceStatus | undefined): string {
  if (status === 'ok') return 'text-accent';
  if (status === 'revalidating') return 'text-muted';
  return 'text-[var(--danger)]';
}
