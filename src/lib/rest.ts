/**
 * Client PostgREST opzionale (Firewall SRL).
 * L'app usa Prisma via DATABASE_URL; questo helper serve per query REST
 * o integrazioni future lato client con la anon key.
 */

function restBase() {
  return (
    process.env.NEXT_PUBLIC_REST_URL?.replace(/\/$/, "") ??
    "https://postgres.firewallsrl.com/rest/v1/analisi_siti"
  );
}

function restHeaders(useServiceRole = false): HeadersInit {
  const key = useServiceRole
    ? process.env.SERVICE_ROLE_KEY
    : process.env.NEXT_PUBLIC_ANON_KEY;
  if (!key) throw new Error("Manca ANON_KEY o SERVICE_ROLE_KEY");
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
}

export async function restGet<T>(
  table: string,
  query = "",
  opts?: { serviceRole?: boolean },
): Promise<T> {
  const url = `${restBase()}/${table}${query ? `?${query}` : ""}`;
  const res = await fetch(url, {
    headers: restHeaders(opts?.serviceRole),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`REST GET ${table}: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}
