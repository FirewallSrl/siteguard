import { decryptSecrets } from "../crypto";
import { sanitizeErrorMessage } from "./safe";
import { withSftp } from "../sftp/client";

export type ChannelTestResult = {
  ok: boolean;
  latencyMs: number;
  message: string;
};

export type ConnectionTestResult = {
  sftp: ChannelTestResult | null;
  api: ChannelTestResult | null;
};

async function testSftp(secretsEnc: string): Promise<ChannelTestResult> {
  const started = Date.now();
  try {
    const secrets = decryptSecrets(secretsEnc);
    if (!secrets.sftp) {
      return {
        ok: false,
        latencyMs: 0,
        message: "Nessuna credenziale SFTP configurata",
      };
    }

    await withSftp(secrets.sftp, async (client, root) => {
      // Verifica accesso in lettura alla root (nessun file scaricato in chiaro al client)
      const list = await client.list(root);
      if (!Array.isArray(list)) {
        throw new Error("Risposta SFTP non valida");
      }
    });

    return {
      ok: true,
      latencyMs: Date.now() - started,
      message: `Connessione SFTP OK · accesso a ${secrets.sftp.rootPath}`,
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      message: sanitizeErrorMessage(err),
    };
  }
}

async function testApi(
  siteUrl: string,
  cms: string,
  secretsEnc: string,
): Promise<ChannelTestResult> {
  const started = Date.now();
  try {
    const secrets = decryptSecrets(secretsEnc);
    if (!secrets.api) {
      return {
        ok: false,
        latencyMs: 0,
        message: "Nessuna credenziale API configurata",
      };
    }

    const base = siteUrl.replace(/\/$/, "");
    let url: string;
    const headers: HeadersInit = { Accept: "application/json" };

    if (cms === "joomla") {
      url = `${base}/api/index.php/v1/users?page[limit]=1`;
      headers.Authorization = `Bearer ${secrets.api.appPassword}`;
      headers.Accept = "application/vnd.api+json";
    } else {
      url = `${base}/wp-json/wp/v2/users/me`;
      const token = Buffer.from(
        `${secrets.api.username}:${secrets.api.appPassword}`,
      ).toString("base64");
      headers.Authorization = `Basic ${token}`;
    }

    const res = await fetch(url, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        message: `API HTTP ${res.status}`,
      };
    }

    return {
      ok: true,
      latencyMs: Date.now() - started,
      message: "API autenticata OK",
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      message: sanitizeErrorMessage(err),
    };
  }
}

export async function testSiteConnection(input: {
  siteUrl: string;
  cms: string;
  secretsEnc: string | null;
  channels?: Array<"sftp" | "api">;
}): Promise<ConnectionTestResult> {
  if (!input.secretsEnc) {
    return {
      sftp: {
        ok: false,
        latencyMs: 0,
        message: "Nessuna credenziale salvata",
      },
      api: {
        ok: false,
        latencyMs: 0,
        message: "Nessuna credenziale salvata",
      },
    };
  }

  const channels = input.channels ?? ["sftp", "api"];
  const [sftp, api] = await Promise.all([
    channels.includes("sftp")
      ? testSftp(input.secretsEnc)
      : Promise.resolve(null),
    channels.includes("api")
      ? testApi(input.siteUrl, input.cms, input.secretsEnc)
      : Promise.resolve(null),
  ]);

  return { sftp, api };
}
