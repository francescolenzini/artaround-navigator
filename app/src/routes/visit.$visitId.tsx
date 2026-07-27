import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useApp } from "../lib/AppContext";
import { apiFetch, getErrorMessage, toAbsoluteUrl } from "../lib/api";
import type { Visit } from "../lib/types";
import { ErrorScreen } from "../components/Shell";
import { RichText } from "../components/RichText";
import { BackLink, HeaderActions } from "../components/Nav";

export const Route = createFileRoute("/visit/$visitId")({
  component: VisitDetail,
});

function VisitDetail() {
  const { visitId } = Route.useParams();
  const { apiConfig, museum, token, setVisit } = useApp();
  const navigate = useNavigate();
  const [visit, setLocalVisit] = useState<Visit | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [coverFailed, setCoverFailed] = useState(false);

  useEffect(() => {
    if (!apiConfig || !token) return;
    setErr(null);
    setLocalVisit(null);
    apiFetch<Visit>(apiConfig, token, `/visits/${visitId}`)
      .then((v) => {
        setLocalVisit(v);
        setVisit(v);
      })
      .catch((e) => setErr(getErrorMessage(e)));
  }, [apiConfig, token, visitId, reloadKey, setVisit]);

  useEffect(() => {
    setCoverFailed(false);
  }, [visitId]);

  if (!token) return <Navigate to="/login" />;
  if (err)
    return (
      <ErrorScreen message={err} onRetry={() => setReloadKey((k) => k + 1)} />
    );

  const artworkCount = visit ? visit.steps.filter((s) => (s.itemIds?.length ?? 0) > 0).length : 0;
  const meta = visit
    ? [
        artworkCount > 0 ? `${artworkCount} opere` : null,
        visit.estimatedDurationMinutes ? `${visit.estimatedDurationMinutes} min` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  const coverSrc = visit
    ? visit.coverImage && apiConfig && !coverFailed
      ? toAbsoluteUrl(apiConfig.baseUrl, visit.coverImage)
      : museum?.coverImage && apiConfig
        ? toAbsoluteUrl(apiConfig.baseUrl, museum.coverImage)
        : undefined
    : undefined;

  return (
    <div className="mx-auto min-h-screen max-w-md bg-background text-foreground">
      <header className="px-5 pt-4">
        <div className="flex items-center justify-between gap-2 pb-3">
          <BackLink label="Torna alle visite" onClick={() => navigate({ to: "/visits" })} />
          <HeaderActions
            onMap={() =>
              navigate({ to: "/map/$visitId", params: { visitId }, search: { from: "visit" } })
            }
          />
        </div>
      </header>

      {!visit ? (
        <p className="px-5 text-muted-foreground">Caricamento…</p>
      ) : (
        <>
          <div className="px-5">
            {coverSrc ? (
              <img
                src={coverSrc}
                alt=""
                className="h-36 w-full rounded-2xl object-cover"
                onError={() => setCoverFailed(true)}
              />
            ) : (
              <div className="h-36 w-full rounded-2xl bg-secondary" aria-hidden />
            )}
            <h1 className="mt-5 text-3xl font-bold leading-tight">{visit.title}</h1>
            {meta && (
              <p className="mt-2 text-sm text-muted-foreground">{meta}</p>
            )}
            <RichText
              value={visit.description}
              className="mt-4 text-base leading-relaxed text-muted-foreground"
            />
          </div>

          <h2 className="px-5 pt-8 pb-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Tappe
          </h2>
          <ol className="border-t border-border px-5">
            {visit.steps.map((s, i) => (
              <li
                key={i}
                className="flex items-start gap-4 border-b border-border py-4 last:border-b-0"
              >
                <span className="w-8 shrink-0 font-display text-lg font-bold leading-none tabular-nums">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="flex-1 leading-none">
                  <span className={badgeClassForType(s.type)}>
                    {labelForType(s.type)}
                  </span>
                  {s.title && (
                    <div className="mt-1 text-base font-semibold">{s.title}</div>
                  )}
                </div>
              </li>
            ))}
          </ol>

          <div className="sticky bottom-0 border-t border-border bg-background/95 px-5 pt-4 pb-5 backdrop-blur">
            <button
              onClick={() =>
                navigate({
                  to: "/player/$visitId/$stepIndex",
                  params: { visitId, stepIndex: "0" },
                })
              }
              className="min-h-[52px] w-full rounded-xl bg-primary text-base font-semibold text-primary-foreground"
            >
              Inizia visita ›
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function labelForType(t: string) {
  switch (t) {
    case "logistics_intro":
      return "Logistica";
    case "main_item":
      return "Tappa principale";
    case "optional_item":
      return "Tappa opzionale";
    case "transition":
      return "Spostamento";
    default:
      return t;
  }
}

// Livello del contenuto della tappa reso solo con tipografia/colore (nessuna
// pillola): le opere (principale/opzionale) prendono l'accento, logistica/
// spostamento restano testo discreto perché non sono opere da visitare.
function badgeClassForType(t: string) {
  const base = "text-[10px] font-semibold uppercase tracking-[0.08em]";
  switch (t) {
    case "main_item":
      return `${base} text-primary`;
    case "optional_item":
      return `${base} text-muted-foreground`;
    default:
      return `${base} text-foreground-subtle`;
  }
}
