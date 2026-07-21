import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useApp } from "../lib/AppContext";
import { apiFetch } from "../lib/api";
import type { AuthUser } from "../lib/types";
import { ErrorScreen, LoadingScreen } from "../components/Shell";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const { apiConfig, museum, loading, error, reload, setAuth } = useApp();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (loading) return <LoadingScreen />;
  if (error || !apiConfig)
    return <ErrorScreen message={error ?? "Config non disponibile"} onRetry={reload} />;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    try {
      const res = await apiFetch<{ token: string; user: AuthUser }>(
        apiConfig,
        null,
        "/auth/login",
        { method: "POST", body: JSON.stringify({ username, password }) },
      );
      setAuth(res.token, res.user);
      navigate({ to: "/visits" });
    } catch (e: any) {
      setErr(e?.message ?? "Login fallito");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-10">
      <div className="w-full max-w-sm">
        {museum?.name && (
          <p className="mb-8 text-center text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            {museum.name}
          </p>
        )}
        <div className="flex items-center justify-center" aria-hidden>
          <span className="font-display text-4xl font-bold">ArtAround</span>
        </div>
        <h1 className="sr-only">ArtAround</h1>
        <p className="mt-3 mb-10 text-center text-base text-muted-foreground">
          La tua guida in ascolto, sala dopo sala.
        </p>
        <form onSubmit={onSubmit} className="flex flex-col gap-5">
          <label className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Username
            </span>
            <input
              className="min-h-[48px] rounded-lg border border-border bg-secondary px-4 text-base text-foreground outline-none focus-visible:border-ring"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Password
            </span>
            <input
              type="password"
              className="min-h-[48px] rounded-lg border border-border bg-secondary px-4 text-base text-foreground outline-none focus-visible:border-ring"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          {err && (
            <div className="rounded-lg border border-destructive/40 bg-card p-3 text-sm text-destructive">
              {err}
            </div>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="mt-1 min-h-[52px] rounded-xl bg-primary text-base font-semibold text-primary-foreground disabled:opacity-50"
          >
            {submitting ? "Accesso…" : "Entra ›"}
          </button>
        </form>
      </div>
    </div>
  );
}
