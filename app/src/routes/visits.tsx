import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useApp } from "../lib/AppContext";
import { apiFetch } from "../lib/api";
import type { ListResponse, VisitSummary } from "../lib/types";
import { ErrorScreen, LoadingScreen } from "../components/Shell";

export const Route = createFileRoute("/visits")({
  component: VisitsPage,
});

function VisitsPage() {
  const { apiConfig, museum, museumReady, token, logout } = useApp();
  const [visits, setVisits] = useState<VisitSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!apiConfig || !museum || !museumReady || !token || !museum.museumId) return;
    setErr(null);
    setVisits(null);
    apiFetch<ListResponse<VisitSummary>>(
      apiConfig,
      token,
      `/visits?museumId=${encodeURIComponent(museum.museumId)}&pageSize=50`,
    )
      .then((r) => setVisits(r.data))
      .catch((e) => setErr(e?.message ?? "Errore"));
  }, [apiConfig, museum, museumReady, token, reloadKey]);

  if (!token) return <Navigate to="/login" />;
  if (!museum || !museumReady) return <LoadingScreen />;
  if (err)
    return (
      <ErrorScreen message={err} onRetry={() => setReloadKey((k) => k + 1)} />
    );

  return (
    <div className="mx-auto min-h-screen max-w-md bg-background pb-10 text-foreground">
      <header className="px-5 pt-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          {museum.name} <span className="text-primary">•</span>
        </p>
        <h1 className="mt-2 text-3xl font-bold">Visite disponibili</h1>
        <div className="mt-4 flex gap-2">
          <a
            href={museum.marketplaceUrl}
            target="_blank"
            rel="noreferrer"
            className="flex min-h-[44px] items-center rounded-full border border-border bg-card px-4 text-sm font-medium"
          >
            Apri Editor ↗
          </a>
          <button
            onClick={logout}
            className="flex min-h-[44px] items-center rounded-full border border-border bg-card px-4 text-sm font-medium text-muted-foreground"
          >
            Esci
          </button>
        </div>
      </header>

      <div className="mt-6 flex flex-col gap-3 px-5">
        {!visits && <p className="text-muted-foreground">Caricamento…</p>}
        {visits?.length === 0 && (
          <p className="text-muted-foreground">Nessuna visita disponibile.</p>
        )}
        {visits?.map((v) => (
          <Link
            key={v.id}
            to="/visit/$visitId"
            params={{ visitId: v.id }}
            className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4 transition active:scale-[0.98]"
          >
            <div className="h-14 w-14 shrink-0 rounded-lg bg-secondary" aria-hidden />
            <div className="min-w-0 flex-1">
              <h3 className="font-display text-base font-bold leading-snug">
                {v.title}
              </h3>
              {v.subtitle && (
                <p className="mt-0.5 truncate text-sm text-muted-foreground">
                  {v.subtitle}
                </p>
              )}
              {(v.estimatedDuration || v.targetAudience) && (
                <p className="mt-1 text-sm text-muted-foreground">
                  <span className="font-semibold text-primary">—</span>{" "}
                  {[v.estimatedDuration, v.targetAudience]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
            </div>
            <span className="text-lg text-muted-foreground" aria-hidden>
              ›
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
