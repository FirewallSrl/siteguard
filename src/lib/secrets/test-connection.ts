import { decryptSecrets, encryptSecrets } from "../crypto";
import { sanitizeErrorMessage } from "./safe";
import { applyDiscovery, discoverSftp } from "../sftp/discover";
import { prisma } from "../db";
import type { DiscoveredCms } from "../sftp/discover";

export type ChannelTestResult = {
  ok: boolean;
  latencyMs: number;
  message: string;
  discovery?: {
    protocol: "sftp" | "ftp" | "ftps";
    port: number;
    rootPath: string;
    cms: DiscoveredCms;
    triedPorts: number[];
    attempts?: string[];
  };
};

export type ConnectionTestResult = {
  sftp: ChannelTestResult | null;
  api: ChannelTestResult | null;
  cms?: DiscoveredCms;
};

async function testSftp(
  siteId: string,
  secretsEnc: string,
  currentCms: string,
): Promise<{ result: ChannelTestResult; cms?: DiscoveredCms }> {
  const started = Date.now();
  try {
    const secrets = decryptSecrets(secretsEnc);
    if (!secrets.sftp) {
      return {
        result: {
          ok: false,
          latencyMs: 0,
          message: "Nessuna credenziale SFTP configurata",
        },
      };
    }

    const discovery = await discoverSftp(secrets.sftp);
    const nextSftp = applyDiscovery(secrets.sftp, discovery);

    // Persisti porta/root scoperte
    const changed =
      nextSftp.port !== secrets.sftp.port ||
      nextSftp.rootPath !== secrets.sftp.rootPath ||
      nextSftp.protocol !== secrets.sftp.protocol ||
      (discovery.cms !== "unknown" && discovery.cms !== currentCms);

    if (changed) {
      const nextCms =
        discovery.cms !== "unknown" ? discovery.cms : currentCms;
      await prisma.site.update({
        where: { id: siteId },
        data: {
          cms: nextCms,
          secretsEnc: encryptSecrets({
            ...secrets,
            sftp: nextSftp,
          }),
        },
      });
    }

    const cmsLabel =
      discovery.cms === "unknown" ? currentCms : discovery.cms;
    const proto = discovery.protocol.toUpperCase();

    return {
      result: {
        ok: true,
        latencyMs: Date.now() - started,
        message: `${proto} OK · porta ${discovery.port} · root ${discovery.rootPath} · ${cmsLabel}`,
        discovery: {
          protocol: discovery.protocol,
          port: discovery.port,
          rootPath: discovery.rootPath,
          cms: discovery.cms,
          triedPorts: discovery.triedPorts,
          attempts: discovery.attempts,
        },
      },
      cms: discovery.cms,
    };
  } catch (err) {
    return {
      result: {
        ok: false,
        latencyMs: Date.now() - started,
        message: sanitizeErrorMessage(err),
      },
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
  siteId: string;
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
  let cms: DiscoveredCms | undefined;

  let sftp: ChannelTestResult | null = null;
  if (channels.includes("sftp")) {
    const out = await testSftp(input.siteId, input.secretsEnc, input.cms);
    sftp = out.result;
    cms = out.cms;
  }

  const effectiveCms =
    cms && cms !== "unknown" ? cms : input.cms;

  const api = channels.includes("api")
    ? await testApi(input.siteUrl, effectiveCms, input.secretsEnc)
    : null;

  return { sftp, api, cms };
}
