"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Loader2, Shield } from "lucide-react";

export function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: String(fd.get("email") || ""),
          password: String(fd.get("password") || ""),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Accesso fallito");
      const next = search.get("next") || "/dashboard";
      router.replace(next.startsWith("/") ? next : "/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore");
      setLoading(false);
    }
  }

  return (
    <div className="login-card" data-page="login">
      <div className="login-brand">
        <span className="brand-mark" aria-hidden>
          <Shield className="h-5 w-5" strokeWidth={2.25} />
        </span>
        <div>
          <p className="login-brand-name">
            Site<span>Guard</span>
          </p>
          <p className="login-brand-sub">Accesso operatore</p>
        </div>
      </div>

      <form className="login-form" onSubmit={onSubmit}>
        <label className="login-label">
          Email
          <input
            className="field"
            name="email"
            type="email"
            autoComplete="username"
            required
            placeholder="tu@azienda.it"
          />
        </label>
        <label className="login-label">
          Password
          <input
            className="field"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            placeholder="••••••••"
          />
        </label>

        {error && <p className="login-error">{error}</p>}

        <button type="submit" className="btn-primary login-submit" disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
              Accesso…
            </>
          ) : (
            "Entra"
          )}
        </button>
      </form>
    </div>
  );
}
