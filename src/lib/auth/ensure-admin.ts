import { prisma } from "@/lib/db";
import { hashPassword } from "./password";

/** Crea l'admin da env se la tabella users è vuota. */
export async function ensureAdminUser() {
  const email = process.env.AUTH_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.AUTH_ADMIN_PASSWORD;
  if (!email || !password) return null;

  const count = await prisma.user.count();
  if (count > 0) {
    return prisma.user.findUnique({ where: { email } });
  }

  return prisma.user.create({
    data: {
      email,
      name: process.env.AUTH_ADMIN_NAME?.trim() || "Admin",
      passwordHash: await hashPassword(password),
    },
  });
}
