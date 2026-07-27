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
    if (!apiConfig || !museum || !museumReady || !token || !museum.museumId) return;
    setErr(null);
    setVisits(null);
    apiFetch<ListResponse<VisitSummary>>(
      apiConfig,
      token,
      `/visits?museumId=${encodeURIComponent(museum.museumId)}&pageSize=50`,
    )
      .then((r) => setVisits(r.data))
      .catch((e) => setErr(getErrorMessage(e)));
  }, [apiConfig, museum, museumReady, token, reloadKey]);

  if (!token) return <Navigate to="/login" />;
  if (!museum || !museumReady) return <LoadingScreen />;
  if (err)
    return (
      <ErrorScreen message={err} onRetry={() => setReloadKey((k) => k + 1)} />
    );

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
          Visite disponibili
        </h1>
        {/* Intro: spiega il modello applicativo a chi non lo conosce, prima che
            debba dedurlo dai comandi del player. Stessa resa tipografica del
            paragrafo di descrizione in visit.$visitId.tsx, per coerenza. */}
        <p className="mt-3.5 text-base leading-relaxed text-muted-foreground">
          {firstNameOf(user?.fullName) ? (
            <>
              Benvenuto <b className="font-semibold text-foreground">{firstNameOf(user?.fullName)}</b>.{" "}
            </>
          ) : (
            <>Benvenuto. </>
          )}
          ArtAround ti guida lungo l'itinerario che scegli: a ogni tappa ascolti il
          racconto dell'opera e puoi chiedere a voce di dirti di più, di meno, o dove
          andare.
        </p>
      </header>

      <div className="mt-6 flex flex-col gap-3 px-5">
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
                <h3 className="font-display text-base font-bold leading-snug">
                  {v.title}
                </h3>
                {v.subtitle && (
                  <p className="mt-0.5 truncate text-sm text-muted-foreground">
                    {v.subtitle}
                  </p>
                )}
                {(v.estimatedDurationMinutes || v.targetAudience) && (
                  <p className="mt-1 flex items-center text-sm text-muted-foreground">
                    <span className="mr-1.5 font-semibold text-primary">~</span>
                    {[
                      v.estimatedDurationMinutes ? `${v.estimatedDurationMinutes} min` : null,
                      v.targetAudience,
                    ]
                      .filter(Boolean)
                      .map((text, i) => (
                        <span key={text} className="flex items-center">
                          {i > 0 && (
                            <span className="mx-2 inline-block h-3 w-px bg-border" aria-hidden />
                          )}
                          {text}
                        </span>
                      ))}
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
