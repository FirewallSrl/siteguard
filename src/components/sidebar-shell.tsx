import { connection } from "next/server";
import { prisma } from "@/lib/db";
import { Sidebar, type SidebarSite } from "@/components/sidebar";

export async function SidebarShell() {
  await connection();
  const sites = await loadSidebarSites();
  return <Sidebar sites={sites} />;
}

async function loadSidebarSites(): Promise<SidebarSite[]> {
  if (!process.env.DATABASE_URL) return [];
  try {
    const rows = await prisma.site.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        cms: true,
        findings: { where: { status: "open" }, select: { id: true } },
      },
    });
    return rows.map((s) => ({
      id: s.id,
      name: s.name,
      cms: s.cms,
      openFindings: s.findings.length,
    }));
  } catch (err) {
    console.error("[sidebar] load sites failed:", err);
    return [];
  }
}
