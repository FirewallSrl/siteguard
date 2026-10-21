import { GUIDE_SECTIONS } from "@/lib/guide-content";

export default function GuidePage() {
  return (
    <div className="space-y-8">
      <header className="hero-band">
        <div>
          <p className="text-sm font-semibold text-white/55">Documentazione</p>
          <h1 className="font-display mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Guida operativa
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-white/50">
            Consultazione rapida: flusso, check disponibili, azioni AI e regole di
            sicurezza. Pensata per operatori e onboarding interno.
          </p>
        </div>
      </header>

      <nav className="panel flex flex-wrap gap-2 p-4">
        {GUIDE_SECTIONS.map((s) => (
          <a key={s.id} href={`#${s.id}`} className="chip chip-cyan hover:opacity-80">
            {s.title}
          </a>
        ))}
      </nav>

      <div className="space-y-5">
        {GUIDE_SECTIONS.map((section) => (
          <section
            key={section.id}
            id={section.id}
            className="panel scroll-mt-24 p-5 sm:p-6"
          >
            <h2 className="font-display text-xl font-bold text-[var(--ink)]">
              {section.title}
            </h2>
            <div className="mt-3 space-y-2 text-sm leading-relaxed text-[var(--muted)]">
              {section.body.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </div>
            {section.bullets && section.bullets.length > 0 && (
              <ul className="mt-3 space-y-1.5 border-l-[3px] border-[var(--cyan)] pl-4 text-sm text-[var(--text)]">
                {section.bullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
