import { useEffect, useState } from "react";
import { useApp } from "../lib/AppContext";
import type { ArtworkMapLocation, FloorConfig, Visit, VisitStep } from "../lib/types";
import { useMapZoomPan } from "../lib/useMapZoomPan";
import { AccountMenu, BackLink } from "./Nav";

/**
 * La mappa è un overlay globale, non una destinazione: si apre da qualsiasi
 * schermata e si chiude solo con l'indietro in alto a sinistra, che nomina la
 * schermata di provenienza. Con `visit === null` mostra la sola pianta del museo.
 */
export function MapView({
  visit,
  currentStepIndex,
  backLabel,
  onBack,
  onGoToStep,
}: {
  visit: Visit | null;
  currentStepIndex: number | null;
  backLabel: string;
  onBack: () => void;
  onGoToStep?: (index: number) => void;
}) {
  const { museum, museumConfig } = useApp();
  const [activePin, setActivePin] = useState<number | null>(currentStepIndex);
  const map = useMapZoomPan();

  // Etichette e immagini delle planimetrie arrivano esclusivamente dalla
  // configurazione statica; i dati editoriali del museo restano separati.
  const floors: FloorConfig[] = museumConfig?.floors ?? [];
  const artworkLocations = museumConfig?.artworkLocations ?? {};
  const singleFloor = floors.length <= 1;
  const configuredFloorCodes = new Set(floors.map((item) => item.floor));
  const unconfiguredFloors = [
    ...new Set(
      (visit?.steps ?? [])
        .map((step) => locationFor(step, artworkLocations)?.floor)
        .filter(
          (value): value is number => value !== undefined && !configuredFloorCodes.has(value),
        ),
    ),
  ].sort((a, b) => a - b);

  // Si apre sul piano della tappa di provenienza, non sul primo della lista:
  // chi arriva dal player si aspetta di vedersi già sulla mappa giusta.
  const requestedStartFloor =
    currentStepIndex != null
      ? locationFor(visit?.steps[currentStepIndex], artworkLocations)?.floor
      : undefined;
  const startFloor =
    requestedStartFloor !== undefined && configuredFloorCodes.has(requestedStartFloor)
      ? requestedStartFloor
      : (floors[0]?.floor ?? 0);
  const [floor, setFloor] = useState<number>(startFloor);

  // Allinea il piano selezionato quando la config del museo diventa disponibile.
  useEffect(() => {
    if (museum) setFloor(startFloor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [museum]);

  const pins = layoutPins(visit?.steps ?? [], floor, artworkLocations);
  const mapSrc = floors.find((f) => f.floor === floor)?.image ?? "";
  const selected = activePin != null ? visit?.steps[activePin] : undefined;
  const selectedLocation = locationFor(selected, artworkLocations);
  const total = visit?.steps.length ?? 0;
  const missingLocations = (visit?.steps ?? []).filter(
    (step) => step.artworkId && !locationFor(step, artworkLocations),
  ).length;
  const { view, natural } = map;

  const changeFloor = (next: number) => {
    // Solo a piano diverso: ritoccando quello attivo l'immagine non si rimonta,
    // quindi `onLoad` non riparte e la pianta resterebbe nascosta per sempre.
    if (next === floor) return;
    setFloor(next);
    setActivePin(null);
    map.resetForNewImage();
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col bg-background pb-8 text-foreground">
      <header className="px-5 pt-4">
        <div className="flex items-center justify-between gap-2 pb-3">
          <BackLink label={backLabel} onClick={onBack} />
          <AccountMenu />
        </div>
        <h1 className="font-display text-[26px] font-semibold tracking-[-0.02em]">Mappa</h1>
        {museum?.name && <p className="mt-1 text-xs text-muted-foreground">{museum.name}</p>}
      </header>

      {/* Selettore piano (solo se il museo ha più piani) */}
      {!singleFloor && (
        <div className="flex gap-2 px-5 pt-3.5">
          {floors.map(({ floor: f, label }) => (
            <button
              key={f}
              onClick={() => changeFloor(f)}
              className={`min-h-[44px] flex-1 rounded-lg px-3 text-xs font-semibold transition-colors ${
                floor === f
                  ? "bg-foreground text-background"
                  : "border border-line bg-card text-muted-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Planimetria: zoom e pan dentro un riquadro di altezza fissa. Immagine e
          pin stanno nello stesso stage trasformato, così restano allineati. */}
      <div className="px-5 pt-3.5">
        {unconfiguredFloors.length > 0 && (
          <p
            role="status"
            className="mb-3 rounded-xl border border-primary/30 bg-card px-3 py-2 text-xs text-foreground"
          >
            Planimetria non configurata per{" "}
            {unconfiguredFloors.length === 1 ? "il piano" : "i piani"}{" "}
            {unconfiguredFloors.join(", ")}. Le relative opere non sono mostrate sulla mappa.
          </p>
        )}
        <div className="relative">
          <div
            ref={map.containerRef}
            {...map.pointerHandlers}
            className="relative h-[min(56vh,440px)] min-h-[240px] w-full touch-none select-none overflow-hidden rounded-2xl border border-border bg-secondary"
          >
            <div
              className="absolute left-0 top-0 will-change-transform"
              style={{
                width: natural?.w,
                height: natural?.h,
                transform: `translate3d(${view.tx}px, ${view.ty}px, 0) scale(${view.scale})`,
                transformOrigin: "0 0",
                visibility: natural ? "visible" : "hidden",
              }}
            >
              <img
                key={mapSrc}
                src={mapSrc}
                alt={singleFloor ? "Mappa del museo" : `Mappa piano ${floor}`}
                onLoad={map.onImageLoad}
                draggable={false}
                className="block h-full w-full select-none"
              />
              {natural &&
                pins.map(({ i, s, x, y, dx, dy }) => {
                  const isCurrent = i === currentStepIndex;
                  const isActive = i === activePin;
                  return (
                    <button
                      key={i}
                      data-pin
                      onClick={() => setActivePin(isActive ? null : i)}
                      title={s.title}
                      style={{
                        left: `${x}%`,
                        top: `${y}%`,
                        // Il counter-scale tiene il pin grande uguale a ogni zoom;
                        // messo prima delle traslazioni, anche il centraggio e
                        // l'offset anti-sovrapposizione restano in pixel di
                        // schermo invece di crescere con la pianta.
                        transform: `scale(${1 / view.scale}) translate(-50%, -50%) translate(${dx}px, ${dy}px)`,
                        transformOrigin: "0 0",
                      }}
                      className={`absolute flex h-8 w-8 items-center justify-center rounded-full font-display text-xs font-bold shadow-md transition-[outline-color,box-shadow] ${
                        isCurrent
                          ? "bg-primary text-primary-foreground outline outline-[3px] outline-primary/25"
                          : "bg-foreground text-background"
                      } ${isActive ? "outline outline-[3px] outline-foreground/30" : ""}`}
                    >
                      {String(i + 1).padStart(2, "0")}
                    </button>
                  );
                })}
            </div>

            {!natural && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                Caricamento mappa…
              </div>
            )}
          </div>

          {/* Controlli zoom: equivalente a bottoni dei gesti, per chi non li usa */}
          <div className="absolute right-2.5 top-1/2 flex -translate-y-1/2 flex-col gap-1.5">
            <ZoomButton label="Ingrandisci" onClick={map.zoomIn}>
              <path strokeLinecap="round" d="M12 5v14M5 12h14" />
            </ZoomButton>
            <ZoomButton label="Riduci" onClick={map.zoomOut}>
              <path strokeLinecap="round" d="M5 12h14" />
            </ZoomButton>
            <ZoomButton label="Adatta al riquadro" onClick={map.reset}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 4H4v5M15 4h5v5M15 20h5v-5M9 20H4v-5"
              />
            </ZoomButton>
          </div>
        </div>
      </div>

      {/* Card della tappa selezionata */}
      <div className="px-5 pt-3.5">
        {selected && activePin != null ? (
          <div className="flex items-center gap-3.5 rounded-2xl border border-border bg-card p-3.5">
            <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-foreground font-display text-[13px] font-bold text-background">
              {String(activePin + 1).padStart(2, "0")}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate font-display text-base font-semibold leading-tight">
                {selected.title ?? `Tappa ${activePin + 1}`}
              </div>
              <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                {selectedLocation?.label ? `${selectedLocation.label} · ` : ""}Tappa {activePin + 1}{" "}
                di {total}
              </div>
            </div>
            {onGoToStep && (
              <button
                onClick={() => onGoToStep(activePin)}
                className="flex min-h-[44px] shrink-0 items-center whitespace-nowrap text-[12.5px] font-semibold text-primary"
              >
                Vai alla tappa ›
              </button>
            )}
          </div>
        ) : (
          <p className="text-center text-[11px] text-foreground-subtle">
            {!visit
              ? "Nessuna visita in corso: questa è la pianta del museo."
              : pins.length === 0
                ? "Nessuna tappa di questa visita su questo piano."
                : "Pizzica per lo zoom, tocca un pin per vedere la tappa."}
          </p>
        )}
        {missingLocations > 0 && (
          <p role="status" className="mt-2.5 text-center text-[11px] text-foreground-subtle">
            {missingLocations} {missingLocations === 1 ? "tappa non ha" : "tappe non hanno"} una
            posizione configurata.
          </p>
        )}
        {visit && currentStepIndex != null && (
          <p className="mt-2.5 text-center text-[11px] text-foreground-subtle">
            Il pin rosso è la tappa da cui sei arrivato.
          </p>
        )}
      </div>
    </div>
  );
}

/** Bottone tondo dei controlli zoom: icona disegnata, nessuna libreria. */
function ZoomButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card/90 text-foreground shadow-md backdrop-blur transition-transform active:scale-95"
    >
      <svg
        className="h-4 w-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden
      >
        {children}
      </svg>
    </button>
  );
}

/**
 * Posizione dei pin sul piano corrente. Le tappe che condividono le stesse
 * coordinate vengono disposte su un cerchietto attorno al punto: il raggio è in
 * pixel (i pin sono 32px, la mappa può avere qualsiasi larghezza) e cresce con il
 * numero di tappe del gruppo, così non si toccano mai.
 */
function locationFor(step: VisitStep | undefined, locations: Record<string, ArtworkMapLocation>) {
  if (!step?.artworkId) return undefined;
  return locations[step.artworkMapKey || step.artworkId];
}

function layoutPins(
  steps: VisitStep[],
  floor: number,
  locations: Record<string, ArtworkMapLocation>,
) {
  const groups = new Map<string, { x: number; y: number; items: { s: VisitStep; i: number }[] }>();

  steps.forEach((s, i) => {
    const location = locationFor(s, locations);
    if (!location || location.floor !== floor) return;
    const key = `${location.x}-${location.y}`;
    const group = groups.get(key) ?? { x: location.x, y: location.y, items: [] };
    group.items.push({ s, i });
    groups.set(key, group);
  });

  return [...groups.values()].flatMap(({ x, y, items }) => {
    const n = items.length;
    // 22px = raggio del pin (16) + respiro; oltre le ~6 tappe il cerchio si allarga
    // per mantenere la stessa distanza minima fra pin adiacenti.
    const radius = n === 1 ? 0 : Math.max(22, (18 * n) / Math.PI);
    return items.map(({ s, i }, idx) => {
      // Spread simmetrico che parte dall'alto: il cluster resta centrato sulla
      // coordinata dell'opera, senza bias verso destra.
      const angle = ((2 * Math.PI) / n) * idx - Math.PI / 2;
      return {
        s,
        i,
        x,
        y,
        dx: radius * Math.cos(angle),
        dy: radius * Math.sin(angle),
      };
    });
  });
}
