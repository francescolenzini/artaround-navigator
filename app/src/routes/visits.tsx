import { createFileRoute, Link, Navigate, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useApp } from "../lib/AppContext";
import { apiFetch, getErrorMessage, toAbsoluteUrl } from "../lib/api";
import type { ListResponse, VisitSummary } from "../lib/types";
import { ErrorScreen, LoadingScreen } from "../components/Shell";
import { HeaderActions } from "../components/Nav";

export const Route = createFileRoute("/visits")({
  component: VisitsPage,
});

function VisitsPage() {
  const { apiConfig, museum, museumReady, token, user } = useApp();
  const navigate = useNavigate();
  const [visits, setVisits] = useState<VisitSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!apiConfig || !museum || !museumReady || !token) return;
    setErr(null);
    setVisits(null);
    apiFetch<ListResponse<VisitSummary>>(
      apiConfig,
      token,
      `/visits?museumId=${encodeURIComponent(museum.id)}&pageSize=50`,
    )
      .then((r) => setVisits(r.data))
      .catch((e) => setErr(getErrorMessage(e)));
  }, [apiConfig, museum, museumReady, token, reloadKey]);

  if (!token) return <Navigate to="/login" />;
  if (!museum || !museumReady) return <LoadingScreen />;
  if (err) return <ErrorScreen message={err} onRetry={() => setReloadKey((k) => k + 1)} />;

  return (
    <div className="mx-auto min-h-screen max-w-md bg-background pb-8 text-foreground">
      <header className="px-5 pt-4">
        {/* Museo a sinistra, mappa + account a destra: come in tutte le altre
            schermate autenticate. Stessa altezza (pt-4/pb-3) su ogni header. */}
        <div className="flex items-center justify-between gap-3 pb-3">
          <p className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
            {museum.name}
          </p>
          <HeaderActions onMap={() => navigate({ to: "/map", search: { from: "visits" } })} />
        </div>
        <h1 className="font-display text-[29px] font-semibold tracking-[-0.02em]">
          Scegli la tua visita
        </h1>
        {/* Intro breve e accogliente: presenta le visite come percorsi curati
            e chiarisce subito il valore della guida. */}
        <div className="mt-3.5 space-y-2 text-base leading-[1.55] text-muted-foreground">
          <p className="font-semibold text-foreground">
            {firstNameOf(user?.fullName)
              ? `Benvenuto, ${firstNameOf(user?.fullName)}.`
              : "Benvenuto."}
          </p>
          <p>
            ArtAround ti accompagna tappa dopo tappa, tra storie, curiosità e indicazioni. Scegli
            una delle nostre visite curate: troverai percorsi dedicati a opere e temi diversi,
            adatti al tempo che hai a disposizione. Durante la visita avrai a disposizione una serie
            di comandi vocali per poter personalizzare la tua esperienza.
          </p>
        </div>
      </header>

      <div className="mt-5 flex flex-col gap-3 px-5">
        {!visits && <p className="text-muted-foreground">Caricamento…</p>}
        {visits?.length === 0 && (
          <p className="text-muted-foreground">Nessuna visita disponibile.</p>
        )}
        {visits?.map((v) => {
          const coverSrc =
            v.coverImage && apiConfig
              ? toAbsoluteUrl(apiConfig.baseUrl, v.coverImage)
              : museum.coverImage && apiConfig
                ? toAbsoluteUrl(apiConfig.baseUrl, museum.coverImage)
                : undefined;
          return (
            <Link
              key={v.id}
              to="/visit/$visitId"
              params={{ visitId: v.id }}
              className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4 transition active:scale-[0.98]"
            >
              {coverSrc ? (
                <img
                  src={coverSrc}
                  alt=""
                  className="h-14 w-14 shrink-0 rounded-lg object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              ) : (
                <div className="h-14 w-14 shrink-0 rounded-lg bg-secondary" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <h3 className="font-display text-base font-bold leading-snug">{v.title}</h3>
                {v.subtitle && (
                  <p className="mt-0.5 truncate text-sm text-muted-foreground">{v.subtitle}</p>
                )}
                {v.estimatedDurationMinutes && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Circa {v.estimatedDurationMinutes} min
                  </p>
                )}
              </div>
              <span className="text-lg text-muted-foreground" aria-hidden>
                ›
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/** Solo il nome di battesimo: "Benvenuto Francesco Lenzini" suona come un badge. */
function firstNameOf(fullName?: string) {
  return fullName?.trim().split(/\s+/)[0] ?? null;
}
