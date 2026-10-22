"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogOut } from "lucide-react";

export function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function logout() {
    setLoading(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.replace("/login");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      className="sidebar-logout"
      onClick={logout}
      disabled={loading}
    >
      <LogOut className="h-3.5 w-3.5" strokeWidth={2} />
      {loading ? "Uscita…" : "Esci"}
    </button>
  );
}
