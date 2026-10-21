"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, LayoutDashboard, PlusSquare, Radar } from "lucide-react";

const links = [
  { href: "/dashboard", label: "Panoramica", icon: LayoutDashboard },
  { href: "/sites/new", label: "Nuovo sito", icon: PlusSquare },
  { href: "/guide", label: "Guida interna", icon: BookOpen },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <>
      <aside className="sidebar" aria-label="Navigazione">
        <div className="sidebar-brand">
          <Link href="/dashboard" className="sidebar-brand-mark">
            <span>Site</span>
            <span>Guard</span>
          </Link>
          <p className="mt-3 text-[0.72rem] leading-relaxed text-[var(--muted)]">
            Scan · integrity · remediation
          </p>
        </div>

        <nav className="sidebar-nav" aria-label="Principale">
          {links.map(({ href, label, icon: Icon }) => {
            const active =
              pathname === href ||
              (href !== "/dashboard" && pathname.startsWith(href));
            return (
              <Link
                key={href}
                href={href}
                data-active={active}
                className="nav-link"
              >
                <Icon className="h-4 w-4 shrink-0 opacity-80" strokeWidth={1.75} />
                {label}
              </Link>
            );
          })}
          {pathname.startsWith("/sites/") && pathname !== "/sites/new" && (
            <div className="nav-link" data-active="true" aria-current="page">
              <Radar className="h-4 w-4 shrink-0 opacity-80" strokeWidth={1.75} />
              Dettaglio sito
            </div>
          )}
        </nav>

        <div className="sidebar-foot">v0.1 · SFTP + CMS API</div>
      </aside>

      {/* Solo mobile — nascosto su desktop via CSS */}
      <div className="mobile-top" aria-label="Menu mobile">
        <Link href="/dashboard" className="sidebar-brand-mark">
          <span>Site</span>
          <span>Guard</span>
        </Link>
        <div className="flex gap-3 text-sm font-medium text-[var(--muted)]">
          <Link href="/dashboard" className="hover:text-[var(--ink)]">
            Home
          </Link>
          <Link href="/sites/new" className="hover:text-[var(--ink)]">
            Nuovo
          </Link>
        </div>
      </div>
    </>
  );
}
