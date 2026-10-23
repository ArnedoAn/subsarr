import type { Metadata } from 'next';
import './globals.css';
import { AppShell } from '@/components/app-shell';
import { ToastProvider } from '@/components/ui/toast';
import { LocalIconCompatibility } from '@/components/ui/icon';


export const metadata: Metadata = {
  title: 'Subsarr',
  description: 'Subtitle translation automation for Jellyfin libraries',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className="h-full antialiased"
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('subsarr-theme');if(t==='light')document.documentElement.classList.add('light');}catch(e){}})();",
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <LocalIconCompatibility />
        <ToastProvider>
          <AppShell>{children}</AppShell>
        </ToastProvider>
      </body>
    </html>
  );
}
