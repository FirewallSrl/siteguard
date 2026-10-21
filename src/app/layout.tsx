import { Suspense } from "react";
import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { Sidebar } from "@/components/sidebar";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex",
  weight: ["400", "500"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SiteGuard — Agent monitoraggio siti",
  description:
    "Scansiona WordPress/Joomla: aggiornamenti, integrity, segnali di compromissione. AI o intervento manuale.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="it"
      className={`${plexSans.variable} ${plexMono.variable} h-full`}
    >
      <body className="min-h-full bg-[var(--bg)] text-[var(--text)] antialiased">
        <Suspense fallback={<SidebarFallback />}>
          <Sidebar />
        </Suspense>
        <div className="app-shell">
          <main className="app-main">
            <div className="page-enter h-full w-full">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}

function SidebarFallback() {
  return (
    <aside className="sidebar" aria-hidden>
      <div className="sidebar-brand">
        <div className="sidebar-brand-mark">
          <span>Site</span>
          <span>Guard</span>
        </div>
      </div>
    </aside>
  );
}
