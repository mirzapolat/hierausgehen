'use client';

import Link from 'next/link';
import { cityById, cities } from '@/lib/cities';
import { locales } from '@/lib/i18n';
import { useSettings, type ThemePreference } from '@/lib/settings/context';
import { ChevronLeft } from './icons';

/**
 * Einstellungen: Erscheinungsbild, Sprache, Zeitformat, Zeitzone und Stadt.
 * Alles wird lokal gespeichert – die App kennt keine Konten.
 */
export function SettingsScreen() {
  const { settings, update, timeZone, t } = useSettings();
  const city = cityById(settings.cityId);

  const themeOptions: { value: ThemePreference; label: string }[] = [
    { value: 'light', label: t('themeLight') },
    { value: 'dark', label: t('themeDark') },
    { value: 'system', label: t('themeSystem') },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center gap-2 bg-[var(--chrome)] px-3 hairline-b">
        <Link
          href="/"
          className="-ml-1 flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-1 text-[12px]
                     text-muted hover:text-text"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          {t('backToCalendar')}
        </Link>
        <h1 className="ml-2 text-[14px] font-semibold tracking-[-0.01em]">{t('settings')}</h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto scroll-quiet">
        <div className="mx-auto w-full max-w-[560px] px-5 py-8">
          <Section title={t('appearance')}>
            <Field label={t('theme')}>
              <Segmented
                value={settings.theme}
                options={themeOptions}
                onChange={(value) => update({ theme: value })}
              />
            </Field>
            <Field label={t('language')}>
              <Segmented
                value={settings.locale}
                options={locales.map((locale) => ({
                  value: locale,
                  label: locale === 'de' ? t('languageDe') : t('languageEn'),
                }))}
                onChange={(value) => update({ locale: value })}
              />
            </Field>
          </Section>

          <Section title={t('regional')}>
            <Field label={t('city')}>
              <Select
                value={settings.cityId}
                onChange={(value) => update({ cityId: value })}
                options={cities.map((c) => ({ value: c.id, label: c.name }))}
              />
            </Field>
            <Field label={t('timeFormat')}>
              <Segmented
                value={settings.hour12 ? '12' : '24'}
                options={[
                  { value: '24', label: t('timeFormat24') },
                  { value: '12', label: t('timeFormat12') },
                ]}
                onChange={(value) => update({ hour12: value === '12' })}
              />
            </Field>
            <Field label={t('timeZone')}>
              <Select
                value={settings.timeZone}
                onChange={(value) => update({ timeZone: value })}
                options={[
                  { value: 'auto', label: t('timeZoneAuto', { zone: city.timeZone }) },
                  ...timeZoneOptions().map((zone) => ({ value: zone, label: zone })),
                ]}
              />
              <p className="mt-1.5 text-[11px] text-faint">
                {new Intl.DateTimeFormat(settings.locale === 'de' ? 'de-DE' : 'en-GB', {
                  timeZone,
                  dateStyle: 'medium',
                  timeStyle: 'short',
                  hour12: settings.hour12,
                }).format(new Date())}
              </p>
            </Field>
          </Section>

          <p className="mt-8 text-[12px] leading-relaxed text-faint">{t('settingsHint')}</p>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-[11px] font-medium uppercase tracking-[0.06em] text-faint">{title}</h2>
      <div className="flex flex-col">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 py-3 hairline-b sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <span className="text-[13px] text-text">{label}</span>
      <div className="sm:max-w-[300px] sm:flex-1">{children}</div>
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex w-full rounded-[var(--radius-sm)] border border-line p-[2px]">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`h-[26px] flex-1 truncate rounded-[3px] px-2 text-[12px] transition-colors ${
            value === option.value
              ? 'bg-[var(--canvas)] text-text shadow-[0_0_0_1px_var(--line)]'
              : 'text-muted hover:text-text'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Select({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-[30px] w-full rounded-[var(--radius-sm)] border border-line bg-[var(--canvas)] px-2
                 text-[13px] text-text focus:border-accent focus:outline-none"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/** Eine überschaubare Auswahl gebräuchlicher Zonen statt der vollen IANA-Liste. */
function timeZoneOptions(): string[] {
  return [
    'Europe/Berlin',
    'Europe/Vienna',
    'Europe/Zurich',
    'Europe/London',
    'Europe/Lisbon',
    'Europe/Athens',
    'Europe/Istanbul',
    'America/New_York',
    'America/Los_Angeles',
    'Asia/Tokyo',
    'Australia/Sydney',
    'UTC',
  ];
}
