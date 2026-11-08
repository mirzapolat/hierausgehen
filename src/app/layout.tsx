import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { SettingsProvider } from '@/lib/settings/context';
import { ServiceWorker } from '@/components/ServiceWorker';
import { UpdateBanner } from '@/components/UpdateBanner';
import { AnalyticsRecorder } from '@/components/AnalyticsRecorder';
import {
  ANALYTICS_DOMAINS,
  ANALYTICS_SCRIPT,
  ANALYTICS_WEBSITE_ID,
} from '@/lib/analytics';
import { APP_NAME, SITE_NAME, pageTitle, SITE_URL } from '@/lib/site';
import { SITE_DESCRIPTION, SITE_KEYWORDS, SITE_TITLE } from '@/lib/site-metadata';
import './globals.css';


export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: pageTitle(SITE_TITLE),
    // Unterseiten hängen sich an, statt den Namen zu wiederholen.
    template: pageTitle('%s'),
  },
  description: SITE_DESCRIPTION,
  keywords: SITE_KEYWORDS,
  applicationName: SITE_NAME,
  authors: [{ name: 'Mirza Polat' }],
  creator: 'Mirza Polat',
  alternates: { canonical: '/' },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
  openGraph: {
    type: 'website',
    locale: 'de_DE',
    url: SITE_URL,
    siteName: SITE_NAME,
    title: pageTitle(SITE_TITLE),
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: pageTitle(SITE_TITLE),
    description: SITE_DESCRIPTION,
  },
  category: 'events',
  manifest: '/manifest.webmanifest',
  // Das App-Icon im hellen und im dunklen Schema (`npm run icons`). Browser
  // wählen über `media`; Favicon und Apple-Icon kommen aus `src/app/`.
  // Startbildschirm-Icons kennen kein dunkles Schema, dort bleibt das helle.
  icons: {
    icon: [
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png', media: '(prefers-color-scheme: light)' },
      { url: '/icon-dark-512.png', sizes: '512x512', type: 'image/png', media: '(prefers-color-scheme: dark)' },
    ],
    // Muss hier stehen: mit `icons` übernimmt Next `src/app/apple-icon.png`
    // nicht mehr von selbst in den Kopf der Seite.
    apple: [{ url: '/apple-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: 'default' },
  formatDetection: { telephone: false, date: false, address: false, email: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // Der Ton der Kopfzeilen (`--chrome` in globals.css), damit Statusleiste
  // und Kopfzeile eine Fläche sind.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fafaf9' },
    { media: '(prefers-color-scheme: dark)', color: '#0e0e10' },
  ],
};

/**
 * Setzt das gespeicherte Erscheinungsbild noch vor dem ersten Malen, damit
 * beim Laden kein heller Blitz im dunklen Modus entsteht.
 */
const themeScript = `try{var s=JSON.parse(localStorage.getItem('hierausgehen.settings.v1')||'{}');
if(s.theme==='light'||s.theme==='dark')document.documentElement.setAttribute('data-theme',s.theme);
if(s.locale)document.documentElement.lang=s.locale;}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="de" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <Script id="theme-bootstrap" strategy="beforeInteractive">
          {themeScript}
        </Script>
      </head>
      <body className="h-full" suppressHydrationWarning>
        <SettingsProvider>
          {children}
          <UpdateBanner />
        </SettingsProvider>
        <ServiceWorker />
        {/* Seitenwechsel im App Router zählt das Skript von selbst mit. */}
        <Script
          defer
          src={ANALYTICS_SCRIPT}
          data-website-id={ANALYTICS_WEBSITE_ID}
          data-domains={ANALYTICS_DOMAINS}
          strategy="afterInteractive"
        />
        {/* Heatmaps und Aufzeichnungen – schaltet Umami serverseitig frei. */}
        <AnalyticsRecorder />
      </body>
    </html>
  );
}
