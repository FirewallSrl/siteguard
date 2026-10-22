import { Suspense } from "react";
import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  return (
    <div className="login-screen" data-page="login">
      <Suspense fallback={<div className="login-card">Caricamento…</div>}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
