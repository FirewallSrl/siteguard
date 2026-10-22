import tls from "tls";
import type { ScanFinding } from "../types";

export type SslCheckResult = {
  findings: ScanFinding[];
  ssl: {
    https: boolean;
    validTo?: string;
    daysLeft?: number;
    subject?: string;
    /** URL salvato era http ma la porta 443 risponde */
    urlWasHttp?: boolean;
  };
};

export async function checkSsl(siteUrl: string): Promise<SslCheckResult> {
  const findings: ScanFinding[] = [];

  let host: string;
  let port = 443;
  let urlWasHttp = false;

  try {
    const u = new URL(siteUrl);
    host = u.hostname;
    if (u.protocol === "http:") {
      urlWasHttp = true;
      port = 443; // probe sempre TLS, anche se l'URL salvato è http
    } else if (u.protocol === "https:") {
      port = u.port ? Number(u.port) || 443 : 443;
    } else {
      return { findings, ssl: { https: false } };
    }
  } catch {
    return { findings, ssl: { https: false } };
  }

  try {
    const cert = await getCertificate(host, port);
    const daysLeft = Math.floor(
      (cert.validTo.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
    );
    const validTo = cert.validTo.toISOString();
    const ssl = {
      https: true as const,
      validTo,
      daysLeft,
      subject: cert.subject,
      urlWasHttp,
    };

    if (urlWasHttp) {
      findings.push({
        type: "config",
        severity: "medium",
        title: "URL salvato in HTTP ma certificato presente",
        description:
          "Il sito risponde in HTTPS (certificato valido). Aggiorna l'URL del sito a https:// e forza il redirect HTTP→HTTPS.",
        evidence: { url: siteUrl, host, validTo, daysLeft },
        proposedPlan: {
          summary: "Usare https:// come URL canonico e forzare redirect",
          steps: [
            "Aggiornare URL sito in SiteGuard a https://",
            "Forzare HTTPS in CMS e server",
            "Verificare mixed content",
          ],
          risk: "medium",
          requiresBackup: false,
        },
      });
    }

    if (daysLeft < 0) {
      findings.push({
        type: "config",
        severity: "critical",
        title: "Certificato SSL scaduto",
        description: `Scaduto il ${validTo.slice(0, 10)}.`,
        evidence: { host, validTo, daysLeft },
        proposedPlan: {
          summary: "Rinnovare immediatamente il certificato SSL",
          steps: ["Rinnovo certificato", "Verificare catena CA", "Test SSL Labs"],
          risk: "critical",
          requiresBackup: false,
        },
      });
    } else if (daysLeft <= 14) {
      findings.push({
        type: "config",
        severity: "high",
        title: `SSL in scadenza tra ${daysLeft} giorni`,
        description: `Validità fino al ${validTo.slice(0, 10)}.`,
        evidence: { host, validTo, daysLeft },
        proposedPlan: {
          summary: "Rinnovare il certificato SSL",
          steps: ["Programmare rinnovo", "Verificare auto-renew"],
          risk: "high",
          requiresBackup: false,
        },
      });
    } else if (daysLeft <= 30) {
      findings.push({
        type: "config",
        severity: "medium",
        title: `SSL scade tra ${daysLeft} giorni`,
        description: `Validità fino al ${validTo.slice(0, 10)}.`,
        evidence: { host, validTo, daysLeft },
        proposedPlan: {
          summary: "Pianificare rinnovo SSL",
          steps: ["Verificare auto-renew hosting"],
          risk: "medium",
          requiresBackup: false,
        },
      });
    }

    return { findings, ssl };
  } catch (err) {
    if (urlWasHttp) {
      findings.push({
        type: "config",
        severity: "high",
        title: "Sito non in HTTPS",
        description:
          "L'URL è in HTTP e non risulta un certificato raggiungibile sulla porta 443.",
        evidence: { url: siteUrl, host },
        proposedPlan: {
          summary: "Abilitare HTTPS e forzare redirect",
          steps: [
            "Installare certificato (Let's Encrypt / hosting)",
            "Forzare HTTPS in CMS e server",
            "Verificare mixed content",
          ],
          risk: "high",
          requiresBackup: false,
        },
      });
      return { findings, ssl: { https: false, urlWasHttp } };
    }

    findings.push({
      type: "config",
      severity: "medium",
      title: "Impossibile verificare SSL",
      description: err instanceof Error ? err.message : "Errore TLS",
      evidence: { host },
      proposedPlan: {
        summary: "Verificare manualmente il certificato",
        steps: ["Controllare firewall/porta 443", "Test SSL Labs"],
        risk: "medium",
        requiresBackup: false,
      },
    });
    // URL già https: non marchiare come "No HTTPS" solo per un errore di probe
    return { findings, ssl: { https: true } };
  }
}

function getCertificate(host: string, port: number) {
  return new Promise<{ validTo: Date; subject: string }>((resolve, reject) => {
    const socket = tls.connect(
      { host, port, servername: host, rejectUnauthorized: false },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        if (!cert || !cert.valid_to) {
          reject(new Error("Certificato non disponibile"));
          return;
        }
        const cn = cert.subject?.CN;
        resolve({
          validTo: new Date(cert.valid_to),
          subject: Array.isArray(cn) ? cn[0] ?? host : cn ?? host,
        });
      },
    );
    socket.setTimeout(12_000, () => {
      socket.destroy();
      reject(new Error("Timeout TLS"));
    });
    socket.on("error", reject);
  });
}
