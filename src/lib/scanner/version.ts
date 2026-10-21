/** Confronta versioni tipo semver (4.3.4 vs 4.4.14). Restituisce <0 se a < b. */
export function compareSemver(a: string, b: string): number {
  const pa = normalizeVersion(a)
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
  const pb = normalizeVersion(b)
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** Estrae la parte numerica (rimuove prefissi tipo "CVS: "). */
export function normalizeVersion(raw: string): string {
  const cleaned = raw.replace(/^CVS:\s*/i, "").trim();
  const match = cleaned.match(/(\d+(?:\.\d+)*)/);
  return match?.[1] ?? cleaned;
}

export function isOutdated(
  current: string | undefined,
  latest: string | undefined,
): boolean {
  if (!current || !latest) return false;
  return compareSemver(current, latest) < 0;
}
