import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaUrl?: string;
};

/**
 * Limita il pool Prisma: su Postgres condiviso (e Vercel multi-istanza)
 * il default (CPU*2+1 per processo) esplode le connessioni idle.
 */
export function withPoolLimits(rawUrl: string): string {
  const u = new URL(rawUrl);
  const onVercel = Boolean(process.env.VERCEL);
  if (!u.searchParams.has("connection_limit")) {
    const limit =
      process.env.PRISMA_CONNECTION_LIMIT?.trim() || (onVercel ? "1" : "3");
    u.searchParams.set("connection_limit", limit);
  }
  if (!u.searchParams.has("pool_timeout")) {
    u.searchParams.set("pool_timeout", process.env.PRISMA_POOL_TIMEOUT || "10");
  }
  if (!u.searchParams.has("connect_timeout")) {
    u.searchParams.set("connect_timeout", "10");
  }
  if (!u.searchParams.has("application_name")) {
    u.searchParams.set(
      "application_name",
      process.env.PRISMA_APP_NAME || (onVercel ? "siteguard-vercel" : "siteguard-local"),
    );
  }
  return u.toString();
}

function createPrisma(url: string) {
  return new PrismaClient({
    datasources: { db: { url } },
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

/** Lazy client — evita init durante il prerender senza DATABASE_URL. */
export function getPrisma(): PrismaClient {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error("DATABASE_URL non configurata");
  }
  const url = withPoolLimits(raw);
  if (!globalForPrisma.prisma || globalForPrisma.prismaUrl !== url) {
    void globalForPrisma.prisma?.$disconnect().catch(() => undefined);
    globalForPrisma.prisma = createPrisma(url);
    globalForPrisma.prismaUrl = url;
  }
  return globalForPrisma.prisma;
}

/** Compat: stesso singleton lazy. */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getPrisma();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
