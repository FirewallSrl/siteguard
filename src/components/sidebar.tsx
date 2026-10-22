"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  LayoutDashboard,
  Plus,
  PlusSquare,
  Shield,
} from "lucide-react";
import { LogoutButton } from "@/components/logout-button";

export type SidebarSite = {
  id: string;
  name: string;
  cms: string;
  openFindings: number;
};

const links = [
  { href: "/dashboard", label: "Panoramica", icon: LayoutDashboard },
  { href: "/sites/new", label: "Nuovo sito", icon: PlusSquare },
  { href: "/guide", label: "Guida interna", icon: BookOpen },
];

function CmsGlyph({ cms }: { cms: string }) {
  const kind = cms.toLowerCase();
  if (kind.includes("wordpress") || kind === "wp") {
    return (
      <span className="cms-glyph cms-glyph-wp" aria-hidden>
        W
      </span>
    );
  }
  if (kind.includes("joomla")) {
    return (
      <span className="cms-glyph cms-glyph-joomla" aria-hidden>
        J
      </span>
    );
  }
  return (
    <span className="cms-glyph cms-glyph-generic" aria-hidden>
      <Shield className="h-3.5 w-3.5" strokeWidth={2} />
    </span>
  );
}

export function Sidebar({ sites = [] }: { sites?: SidebarSite[] }) {
  const pathname = usePathname();

  if (pathname === "/login") return null;

  return (
    <>
      <aside className="sidebar" aria-label="Navigazione">
        <div className="sidebar-brand">
          <Link href="/dashboard" className="sidebar-brand-row">
            <span className="brand-mark" aria-hidden>
              <Shield className="h-4 w-4" strokeWidth={2.25} />
            </span>
            <span className="sidebar-brand-mark">
              <span>Site</span>
              <span>Guard</span>
            </span>
          </Link>
          <p className="sidebar-tagline">Scan · integrity · remediation</p>
        </div>

        <nav className="sidebar-nav" aria-label="Principale">
          {links.map(({ href, label, icon: Icon }) => {
            const active =
              pathname === href ||
              (href === "/guide" && pathname.startsWith("/guide"));
            return (
              <Link
                key={href}
                href={href}
                data-active={active}
                className="nav-pill"
              >
                <span className="nav-pill-icon">
                  <Icon className="h-4 w-4" strokeWidth={1.75} />
                </span>
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-sites">
          <div className="sidebar-sites-head">
            <span>Siti</span>
            <Link
              href="/sites/new"
              className="sidebar-sites-add"
              title="Nuovo sito"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
            </Link>
          </div>
          {sites.length === 0 ? (
            <p className="sidebar-sites-empty">Nessun sito ancora</p>
          ) : (
            <ul className="sidebar-sites-list">
              {sites.map((site) => {
                const href = `/sites/${site.id}`;
                const active =
                  pathname === href || pathname.startsWith(`${href}/`);
                return (
                  <li key={site.id}>
                    <Link
                      href={href}
                      className="site-pill"
                      data-active={active || undefined}
                    >
                      <CmsGlyph cms={site.cms} />
                      <span className="min-w-0 flex-1">
                        <span className="site-pill-name">{site.name}</span>
                        <span className="site-pill-meta">
                          {site.cms}
                          {site.openFindings > 0
                            ? ` · ${site.openFindings} open`
                            : " · ok"}
                        </span>
                      </span>
                      {site.openFindings > 0 ? (
                        <span className="sidebar-site-badge">
                          {site.openFindings}
                        </span>
                      ) : (
                        <span className="site-pill-ok" aria-hidden />
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="sidebar-foot">
          <LogoutButton />
          <p className="sidebar-foot-meta">
            <span className="sidebar-foot-dot" aria-hidden />
            v0.1 · SFTP + CMS API
          </p>
        </div>
      </aside>

      <div className="mobile-top" aria-label="Menu mobile">
        <Link href="/dashboard" className="sidebar-brand-row">
          <span className="brand-mark" aria-hidden>
            <Shield className="h-3.5 w-3.5" strokeWidth={2.25} />
          </span>
          <span className="sidebar-brand-mark">
            <span>Site</span>
            <span>Guard</span>
          </span>
        </Link>
        <div className="mobile-pills">
          <Link
            href="/dashboard"
            className="nav-pill nav-pill-sm"
            data-active={pathname === "/dashboard"}
          >
            Home
          </Link>
          <Link href="/sites/new" className="nav-pill nav-pill-sm">
            Nuovo
          </Link>
        </div>
      </div>
    </>
  );
}
