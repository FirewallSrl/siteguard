import type { ScanFinding } from "./types";

export function buildDemoFindings(siteUrl: string): ScanFinding[] {
  return [
    {
      type: "update_core",
      severity: "high",
      title: "WordPress core non aggiornato",
      description: "Rilevata versione 6.4.3; disponibile 6.7.x (demo).",
      evidence: { current: "6.4.3", latest: "6.7.2", siteUrl },
      proposedPlan: {
        summary: "Aggiornare WordPress core all'ultima versione stabile",
        steps: [
          "Backup completo file + database",
          "Aggiornare core via API o wp-admin",
          "Verificare homepage e wp-admin",
        ],
        risk: "high",
        requiresBackup: true,
      },
    },
    {
      type: "update_plugin",
      severity: "medium",
      title: "Plugin da aggiornare: Contact Form 7",
      description: "5.8.1 → 6.0.3 (demo).",
      evidence: {
        plugin: "contact-form-7/wp-contact-form-7.php",
        from: "5.8.1",
        to: "6.0.3",
      },
      proposedPlan: {
        summary: "Aggiornare Contact Form 7",
        steps: ["Backup", "Update plugin via REST", "Test form contatti"],
        risk: "medium",
        requiresBackup: true,
      },
    },
    {
      type: "malware",
      severity: "critical",
      title: "File sospetto in uploads",
      description:
        "Trovato pattern eval(base64_decode) in wp-content/uploads/cache.php (demo).",
      evidence: {
        filePath: "wp-content/uploads/cache.php",
        patternId: "eval_base64",
      },
      proposedPlan: {
        summary: "Quarantena e rimozione del file sospetto",
        steps: [
          "Scaricare copia forense del file",
          "Eliminare via SFTP",
          "Cercare altri file con lo stesso pattern",
          "Reset password admin",
        ],
        risk: "critical",
        requiresBackup: true,
      },
    },
    {
      type: "suspicious_user",
      severity: "high",
      title: "Utente admin sospetto: wp_support",
      description: "Account administrator creato di recente non in whitelist (demo).",
      evidence: { username: "wp_support", role: "administrator" },
      proposedPlan: {
        summary: "Disattivare/eliminare l'utente admin sospetto",
        steps: [
          "Confermare con il cliente",
          "Eliminare utente via REST API",
          "Revisionare altri utenti",
        ],
        risk: "high",
        requiresBackup: false,
      },
    },
    {
      type: "settings_hijack",
      severity: "critical",
      title: "siteurl punta a dominio esterno",
      description: `Settings URL diversa da ${siteUrl} (demo).`,
      evidence: {
        settingsUrl: "https://evil-redirect.example",
        expected: siteUrl,
      },
      proposedPlan: {
        summary: "Ripristinare siteurl e home",
        steps: [
          "Impostare URL corrette via API settings",
          "Controllare .htaccess",
          "Purgare cache CDN",
        ],
        risk: "critical",
        requiresBackup: true,
      },
    },
  ];
}
