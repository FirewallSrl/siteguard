import type { ApiCredentials } from "../types";

async function joomlaFetch<T>(
  siteUrl: string,
  path: string,
  creds: ApiCredentials,
): Promise<T> {
  const base = siteUrl.replace(/\/$/, "");
  const res = await fetch(`${base}/api/index.php/v1${path}`, {
    headers: {
      Authorization: `Bearer ${creds.appPassword}`,
      Accept: "application/vnd.api+json",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Joomla API ${path} → ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchJoomlaUsers(siteUrl: string, creds: ApiCredentials) {
  return joomlaFetch<{ data: unknown[] }>(siteUrl, "/users", creds);
}

export async function fetchJoomlaExtensions(
  siteUrl: string,
  creds: ApiCredentials,
) {
  return joomlaFetch<{ data: unknown[] }>(siteUrl, "/extensions", creds);
}
