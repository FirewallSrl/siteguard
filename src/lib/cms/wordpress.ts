import type { ApiCredentials } from "../types";

export type WpUser = {
  id: number;
  name: string;
  slug: string;
  roles?: string[];
};

export type WpPlugin = {
  plugin: string;
  status: string;
  name: string;
  version?: string;
  update?: string;
};

export type WpTheme = {
  stylesheet: string;
  name?: string;
  status?: string;
  version?: string;
  update?: string;
};

export type WpSettings = {
  title?: string;
  description?: string;
  url?: string;
  email?: string;
};

function authHeader(creds: ApiCredentials) {
  const token = Buffer.from(`${creds.username}:${creds.appPassword}`).toString(
    "base64",
  );
  return `Basic ${token}`;
}

async function wpFetch<T>(
  siteUrl: string,
  path: string,
  creds: ApiCredentials,
  init?: RequestInit,
): Promise<T> {
  const base = siteUrl.replace(/\/$/, "");
  const res = await fetch(`${base}/wp-json${path}`, {
    ...init,
    headers: {
      Authorization: authHeader(creds),
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WP API ${path} → ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchWpUsers(siteUrl: string, creds: ApiCredentials) {
  return wpFetch<WpUser[]>(
    siteUrl,
    "/wp/v2/users?context=edit&per_page=100",
    creds,
  );
}

export async function fetchWpPlugins(siteUrl: string, creds: ApiCredentials) {
  return wpFetch<WpPlugin[]>(siteUrl, "/wp/v2/plugins", creds);
}

export async function fetchWpThemes(siteUrl: string, creds: ApiCredentials) {
  return wpFetch<WpTheme[]>(siteUrl, "/wp/v2/themes", creds);
}

export async function fetchWpSettings(siteUrl: string, creds: ApiCredentials) {
  return wpFetch<WpSettings>(siteUrl, "/wp/v2/settings", creds);
}

export async function updateWpSettings(
  siteUrl: string,
  creds: ApiCredentials,
  patch: Partial<WpSettings>,
) {
  return wpFetch<WpSettings>(siteUrl, "/wp/v2/settings", creds, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function updateWpPlugin(
  siteUrl: string,
  creds: ApiCredentials,
  pluginFile: string,
) {
  return wpFetch<unknown>(
    siteUrl,
    `/wp/v2/plugins/${encodeURIComponent(pluginFile)}`,
    creds,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    },
  );
}

export async function deleteWpUser(
  siteUrl: string,
  creds: ApiCredentials,
  userId: number,
  reassign = 1,
) {
  return wpFetch<unknown>(
    siteUrl,
    `/wp/v2/users/${userId}?force=true&reassign=${reassign}`,
    creds,
    { method: "DELETE" },
  );
}
