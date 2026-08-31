import type { Metadata, Viewport } from 'next';
import { SettingsProvider } from '@/lib/settings/context';
import './globals.css';

export const metadata: Metadata = {
  title: 'Hier ausgehen — Veranstaltungen in München',
  description:
    'Ein Kalender für alle Veranstaltungen in München: Oper, Theater, Konzert und Kultur an einem Ort.',
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
      <body className="h-full">
        <SettingsProvider>{children}</SettingsProvider>
      </body>
    </html>
  );
}
