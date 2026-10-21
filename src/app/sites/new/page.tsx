import { AddSiteForm } from "@/components/add-site-form";

export default function NewSitePage() {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <header className="hero-band">
        <div>
          <p className="text-sm font-semibold text-white/55">Onboarding</p>
          <h1 className="font-display mt-2 text-3xl font-bold tracking-tight text-white">
            Nuovo sito
          </h1>
          <p className="mt-2 text-sm text-white/50">
            Inserisci URL e accessi. Potrai testarli subito nella pagina del sito.
          </p>
        </div>
      </header>

      <div className="flow-steps !grid-cols-1 sm:!grid-cols-3">
        <div className="flow-step">
          <span className="flow-num">1</span>
          <div>
            <strong>Dati sito</strong>
            <div>Nome, URL, CMS</div>
          </div>
        </div>
        <div className="flow-step">
          <span className="flow-num">2</span>
          <div>
            <strong>Accessi</strong>
            <div>SFTP e/o API</div>
          </div>
        </div>
        <div className="flow-step">
          <span className="flow-num">3</span>
          <div>
            <strong>Test + scan</strong>
            <div>Nella pagina dettaglio</div>
          </div>
        </div>
      </div>

      <AddSiteForm />
    </div>
  );
}
