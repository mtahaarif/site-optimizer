import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { Sidebar } from './nav.tsx';
import { ThemeToggle } from './theme-toggle.tsx';

// Runs before paint: applies the saved theme (or the OS preference) so there is
// no flash of the wrong palette on load.
const THEME_INIT = `(function(){try{var t=localStorage.getItem('theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components

// Bundled fallback for Apercu. Kept light-weighted to match the Thin house face;
// once the licensed Apercu woff2 lands in public/fonts/ it takes precedence.
const fallback = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-sans-fallback',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
});

// Absolute base for canonical + Open Graph URLs. Set SITE_URL to your real
// domain in production; falls back to the local dev origin.
const SITE_URL = process.env['SITE_URL'] ?? 'http://localhost:3000';
const DESCRIPTION =
  'Run deep technical SEO audits, track your rankings across Google, Bing, Yahoo and Yandex, and monitor uptime and backlinks — all in one place.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'SiteChecker — technical SEO audits & rank tracking',
    template: '%s · SiteChecker',
  },
  description: DESCRIPTION,
  applicationName: 'SiteChecker',
  // NOTE: deliberately no `alternates.canonical` here. A canonical set on the
  // root layout is inherited by every page that doesn't override it, which makes
  // the whole site canonicalise to the homepage — the classic template bug our
  // own `canonical-points-homepage` check flags. Each page sets its own.
  openGraph: {
    type: 'website',
    siteName: 'SiteChecker',
    title: 'SiteChecker — technical SEO audits & rank tracking',
    description: DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'SiteChecker — technical SEO audits & rank tracking',
    description: DESCRIPTION,
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${fallback.variable} ${jetbrainsMono.variable}`}>
      <body className="min-h-screen bg-ground font-sans text-ink">
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        <div className="flex">
          <Sidebar />
          <div className="min-w-0 flex-1">
            <main className="mx-auto max-w-[1400px] px-6 py-8 lg:px-10">{children}</main>
          </div>
        </div>
        <ThemeToggle />
      </body>
    </html>
  );
}
