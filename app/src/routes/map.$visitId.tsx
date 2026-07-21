import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useApp } from "../lib/AppContext";
import { apiFetch } from "../lib/api";
import type { FloorConfig, Visit } from "../lib/types";
import { ErrorScreen, LoadingScreen } from "../components/Shell";

export const Route = createFileRoute("/map/$visitId")({
  component: MapPage,
});

function MapPage() {
  const { visitId } = Route.useParams();
  const { apiConfig, token, museum, visit: ctxVisit, setVisit } = useApp();
  const navigate = useNavigate();
  const [visit, setLocalVisit] = useState<Visit | null>(
    ctxVisit && ctxVisit.id === visitId ? ctxVisit : null,
  );
  const [err, setErr] = useState<string | null>(null);
  const [activePin, setActivePin] = useState<number | null>(null);

  // I piani (etichetta + immagine mappa) arrivano dalla configurazione del museo,
  // così il Navigator resta generico e multi-museo. Fallback a un'unica mappa
  // (museum.mapImage) per i musei che non definiscono piani.
  const floors: FloorConfig[] =
    museum?.floors && museum.floors.length > 0
      ? museum.floors
      : [{ floor: 0, label: "Mappa", image: museum?.mapImage ?? "" }];
  const singleFloor = floors.length <= 1;

  const [floor, setFloor] = useState<number>(floors[0].floor);

  // Allinea il piano selezionato quando la config del museo diventa disponibile.
  useEffect(() => {
    if (museum) setFloor(floors[0].floor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [museum]);

  useEffect(() => {
    if (!apiConfig || !token || (visit && visit.id === visitId)) return;
    apiFetch<Visit>(apiConfig, token, `/visits/${visitId}`)
      .then((v) => {
        setLocalVisit(v);
        setVisit(v);
      })
      .catch((e) => setErr(e?.message ?? "Errore"));
  }, [apiConfig, token, visitId, visit, setVisit]);

  if (!token) return <Navigate to="/login" />;
  if (err) return <ErrorScreen message={err} />;
  if (!visit) return <LoadingScreen />;

  const RADIUS = 2.5;

  const groups = visit.steps.reduce(
    (acc, s, i) => {
      if (!s.mapCoords) return acc;
      if (!singleFloor && s.mapCoords.floor !== floor) return acc;
      const key = `${s.mapCoords.x}-${s.mapCoords.y}`;
      if (!acc[key]) acc[key] = { x: s.mapCoords.x, y: s.mapCoords.y, items: [] };
      acc[key].items.push({ s, i });
      return acc;
    },
    {} as Record<
      string,
      { x: number; y: number; items: { s: (typeof visit.steps)[0]; i: number }[] }
    >,
  );

  const pins = Object.values(groups).flatMap(({ x, y, items }) => {
    const n = items.length;
    return items.map(({ s, i }, idx) => {
      const angle = n === 1 ? 0 : ((2 * Math.PI) / n) * idx;
      const offsetX = n === 1 ? 0 : RADIUS * Math.cos(angle);
      const offsetY = n === 1 ? 0 : RADIUS * Math.sin(angle);
      return { s, i, px: x + offsetX, py: y + offsetY };
    });
  });

  const mapSrc = floors.find((f) => f.floor === floor)?.image ?? floors[0].image;

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col bg-background pb-24 text-foreground">
      <header className="px-5 pt-6">
        {museum?.name && (
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {museum.name}
          </p>
        )}
        <h1 className="mt-1 text-3xl font-bold">Mappa</h1>
      </header>

      {/* Selettore piano (solo se il museo ha più piani) */}
      {!singleFloor && (
        <div className="flex gap-2 px-5 pt-4">
          {floors.map(({ floor: f, label }) => (
            <button
              key={f}
              onClick={() => {
                setFloor(f);
                setActivePin(null);
              }}
              className={`min-h-[44px] flex-1 rounded-lg px-3 text-sm font-semibold transition-colors ${
                floor === f
                  ? "bg-foreground text-background"
                  : "border border-border bg-card text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Mappa con pin */}
      <div className="px-5 pt-4">
        <div className="w-full overflow-auto rounded-2xl border border-border bg-card">
          {/* si espande con l'immagine: i pin in % restano allineati */}
          <div className="relative w-[150%]">
            <img src={mapSrc} alt={`Mappa piano ${floor}`} className="block w-full max-w-none" />
            {pins.map(({ s, i, px, py }) => (
              <button
                key={i}
                onClick={() => setActivePin(activePin === i ? null : i)}
                style={{ left: `${px}%`, top: `${py}%` }}
                className={`absolute flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 text-sm font-bold shadow-md transition-transform ${
                  activePin === i
                    ? "scale-110 border-primary bg-card text-primary"
                    : "border-card bg-primary text-primary-foreground"
                }`}
              >
                {i + 1}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Card opera selezionata */}
      {activePin !== null ? (
        <div className="mx-5 mt-4 flex items-center gap-4 rounded-2xl border border-border bg-card p-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary font-display text-sm font-bold text-primary-foreground">
            {String(activePin + 1).padStart(2, "0")}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-semibold">{visit.steps[activePin].title}</div>
            <div className="text-sm text-muted-foreground">Tappa {activePin + 1}</div>
          </div>
          <button
            onClick={() =>
              navigate({
                to: "/player/$visitId/$stepIndex",
                params: { visitId, stepIndex: String(activePin) },
              })
            }
            className="flex min-h-[44px] shrink-0 items-center text-sm font-semibold text-primary"
          >
            Vai alla tappa ›
          </button>
        </div>
      ) : (
        <p className="mt-4 px-5 text-center text-sm text-muted-foreground">
          Tocca un pin sulla mappa per aprire la sua opera.
        </p>
      )}

      {/* Bottone indietro */}
      <button
        onClick={() => window.history.back()}
        className="fixed bottom-6 left-1/2 min-h-[48px] -translate-x-1/2 rounded-full bg-foreground px-6 py-3 font-semibold text-background shadow-xl"
      >
        ‹ Indietro
      </button>
    </div>
  );
}
