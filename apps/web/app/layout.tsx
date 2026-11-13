import './globals.css';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { ThemeProvider } from '@/components/theme-provider';
import { LanguageProvider, mergeDictionaries } from '@saas/ui';
import { Toaster } from 'sonner';
import { webDictionaries } from '@/lib/dictionaries';
import { PluginDictionaries } from '@/lib/plugin-dictionaries';
import type { Metadata } from 'next';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

// Merge all dictionaries: web app + plugins
const allDictionaries = mergeDictionaries(webDictionaries, ...PluginDictionaries);

const appName = 'SaaS Admin';

export const metadata: Metadata = {
  // title: {
  //   template: `%s | ${appName}`,
  //   default: appName,
  // },
  description: `${appName} administration panel`,
  icons: {
    icon: '/favicon.ico',
    shortcut: '/favicon.ico',
    apple: '/apple-icon.png',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} ${jetbrainsMono.variable} font-sans`}>
        <LanguageProvider dictionaries={allDictionaries}>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            {children}
            <Toaster position="bottom-right" />
          </ThemeProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
