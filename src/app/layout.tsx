import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { SettingsProvider } from '@/lib/settings/context';
import { ServiceWorker } from '@/components/ServiceWorker';
import {
  ANALYTICS_DOMAINS,
  ANALYTICS_SCRIPT,
  ANALYTICS_WEBSITE_ID,
  SITE_DESCRIPTION,
  SITE_KEYWORDS,
  SITE_NAME,
  SITE_TITLE,
  SITE_URL,
} from '@/lib/site';
import './globals.css';


export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — ${SITE_TITLE}`,
    // Unterseiten hängen sich an, statt den Namen zu wiederholen.
    template: `%s — ${SITE_NAME}`,
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
    title: `${SITE_NAME} — ${SITE_TITLE}`,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE_NAME} — ${SITE_TITLE}`,
    description: SITE_DESCRIPTION,
  },
  category: 'events',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: SITE_NAME, statusBarStyle: 'default' },
  formatDetection: { telephone: false, date: false, address: false, email: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#141416' },
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
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="h-full" suppressHydrationWarning>
        <SettingsProvider>{children}</SettingsProvider>
        <ServiceWorker />
        {/* Seitenwechsel im App Router zählt das Skript von selbst mit. */}
        <Script
          defer
          src={ANALYTICS_SCRIPT}
          data-website-id={ANALYTICS_WEBSITE_ID}
          data-domains={ANALYTICS_DOMAINS}
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
