export type GuideSection = {
  id: string;
  title: string;
  body: string[];
  bullets?: string[];
};

export const GUIDE_SECTIONS: GuideSection[] = [
  {
    id: "overview",
    title: "Cos'è SiteGuard",
    body: [
      "SiteGuard monitora siti WordPress e Joomla: aggiornamenti, integrity file, segnali di compromissione e hardening.",
      "L'agente propone un piano; tu scegli se farlo eseguire all'AI o intervenire manualmente (human-in-the-loop).",
    ],
  },
  {
    id: "flow",
    title: "Flusso operativo",
    body: ["Ordine consigliato per ogni sito:"],
    bullets: [
      "1. Aggiungi sito (nome, URL, CMS)",
      "2. Configura Accessi (SFTP e/o API) e salva",
      "3. Premi «Testa la connessione»",
      "4. «Scansiona ora»",
      "5. Tab Panoramica: versione CMS, componenti/plugin/temi",
      "6. Tab Finding: Esegui con AI / Faccio io / Ignora",
      "7. Controlla Attività (scan e azioni)",
    ],
  },
  {
    id: "inventory",
    title: "Panoramica inventario",
    body: [
      "Ad ogni scan viene salvato un inventario del sito (anche senza finding critici).",
    ],
    bullets: [
      "Joomla: versione core, componenti, plugin, moduli, template (via SFTP/API)",
      "WordPress: versione core, plugin, temi, conteggio utenti/admin",
      "SSL: HTTPS e giorni alla scadenza",
      "Visibile nella tab «Panoramica» della scheda sito",
    ],
  },
  {
    id: "channels",
    title: "Canali di accesso",
    body: [
      "Due canali complementari. Non servono plugin sul sito cliente.",
    ],
    bullets: [
      "SFTP — filesystem: malware, .htaccess, wp-config, versioni core, checksum, cleanup file",
      "API CMS — dati DB mediato: utenti, settings/siteurl, plugin/temi e update",
      "HTTPS pubblico — scadenza certificato SSL (senza credenziali)",
    ],
  },
  {
    id: "checks-wp-api",
    title: "Check API WordPress",
    body: ["Eseguiti se è configurata Application Password:"],
    bullets: [
      "Numero amministratori (>3 → alert)",
      "Username admin generici (es. admin)",
      "Hijack siteurl / settings URL",
      "Plugin attivi con update disponibile",
      "Temi con update (severità alta se attivo)",
      "Troppi plugin inattivi (≥5)",
      "API irraggiungibile / permessi insufficienti",
    ],
  },
  {
    id: "checks-sftp",
    title: "Check SFTP (WordPress)",
    body: ["Eseguiti sulla root indicata (es. /httpdocs):"],
    bullets: [
      "Versione core vs ultima su WordPress.org",
      "WP_DEBUG attivo",
      "DISALLOW_FILE_EDIT assente",
      "FORCE_SSL_ADMIN disabilitato",
      ".htaccess sospetto (auto_prepend, redirect esterni)",
      "File PHP in uploads (lista + pattern malware)",
      "Scan malware in cache/upgrade e drop-in wp-content",
      "Integrità sample core (version.php, wp-login.php, wp-settings.php) vs checksum ufficiali",
    ],
  },
  {
    id: "checks-malware",
    title: "Pattern malware riconosciuti",
    body: ["Euristiche su contenuto file (non antivirus completo):"],
    bullets: [
      "eval(base64_decode)",
      "gzinflate / str_rot13 obfuscation",
      "shell_exec / system / passthru / proc_open",
      "Web shell note (FilesMan, WSO, b374k, c99, r57)",
      "assert dinamico, preg_replace /e, create_function",
      "eval su $_POST/$_GET",
      "chr() obfuscation, base64 lunghi",
      "Creazione utenti admin via codice",
      "auto_prepend/append in .htaccess",
    ],
  },
  {
    id: "checks-ssl-joomla",
    title: "SSL e Joomla",
    body: [],
    bullets: [
      "SSL: assenza HTTPS, certificato scaduto / in scadenza (14 / 30 giorni)",
      "URL rotti: crawl fino a 10 pagine, fino a ~100 link (4xx/5xx/timeout) — risultato in Panoramica e Finding",
      "Joomla API: troppi Super User, inventario estensioni, errori token",
      "Joomla SFTP: scan PHP in images/tmp/root con stessi pattern malware",
    ],
  },
  {
    id: "actions",
    title: "Azioni remediation (AI)",
    body: [
      "Solo dopo «Esegui con AI» (approve). Con DEMO_SCAN=true le azioni sono simulate.",
    ],
    bullets: [
      "update_plugin → REST WordPress",
      "settings_hijack → ripristino siteurl via API",
      "suspicious_user → delete user (se evidence.id presente)",
      "malware → rename/quarantena o delete via SFTP",
      "Altri tipi → checklist manuale (nessun side-effect automatico)",
    ],
  },
  {
    id: "security",
    title: "Sicurezza della piattaforma",
    body: ["Come tuteliamo le credenziali dei clienti:"],
    bullets: [
      "AES-256-GCM at rest (CREDENTIALS_SECRET solo server)",
      "Le API non restituiscono mai password/chiavi — solo metadati",
      "Campo password vuoto in edit = mantieni valore esistente",
      "HTTPS obbligatorio in produzione (Vercel)",
      "Audit log senza secret; messaggi errore sanificati",
      "Test connessione e scan girano solo server-side",
    ],
  },
  {
    id: "demo",
    title: "Modalità demo",
    body: [
      "DEMO_SCAN=true forza finding di esempio solo se non ci sono credenziali.",
      "Con credenziali salvate lo scan è sempre live (anche se DEMO_SCAN=true per le azioni simulate).",
      "Per remediation reale: DEMO_SCAN=false.",
    ],
  },
  {
    id: "limits",
    title: "Limiti noti",
    body: [],
    bullets: [
      "Non è un antivirus forense completo — sono euristiche + checksum sample",
      "Update core/tema automatici non ancora applicati via AI (solo plugin + file + settings/user)",
      "Joomla update feed meno ricco di WP REST",
      "Vercel: job lunghi meglio via Inngest in produzione",
      "Auth multi-utente sulla piattaforma ancora da aggiungere",
    ],
  },
];
