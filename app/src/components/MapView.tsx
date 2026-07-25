import { useEffect, useState } from "react";
import { useApp } from "../lib/AppContext";
import type { FloorConfig, Visit, VisitStep } from "../lib/types";
import { BackLink } from "./Nav";

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
  const { museum } = useApp();
  const [activePin, setActivePin] = useState<number | null>(currentStepIndex);

  // I piani (etichetta + immagine mappa) arrivano dalla configurazione del museo,
  // così il Navigator resta generico e multi-museo. Fallback a un'unica mappa
  // (museum.mapImage) per i musei che non definiscono piani.
  const floors: FloorConfig[] =
    museum?.floors && museum.floors.length > 0
      ? museum.floors
      : [{ floor: 0, label: "Mappa", image: museum?.mapImage ?? "" }];
  const singleFloor = floors.length <= 1;

  // Si apre sul piano della tappa di provenienza, non sul primo della lista:
  // chi arriva dal player si aspetta di vedersi già sulla mappa giusta.
  const startFloor =
    (currentStepIndex != null
      ? visit?.steps[currentStepIndex]?.mapCoords?.floor
      : undefined) ?? floors[0].floor;
  const [floor, setFloor] = useState<number>(startFloor);

  // Allinea il piano selezionato quando la config del museo diventa disponibile.
  useEffect(() => {
    if (museum) setFloor(startFloor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [museum]);

  const pins = layoutPins(visit?.steps ?? [], floor, singleFloor);
  const mapSrc = floors.find((f) => f.floor === floor)?.image ?? floors[0].image;
  const selected = activePin != null ? visit?.steps[activePin] : undefined;
  const total = visit?.steps.length ?? 0;

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col bg-background pb-8 text-foreground">
      <header className="px-5 pt-3">
        <BackLink label={backLabel} onClick={onBack} />
        <h1 className="mt-3 font-display text-[26px] font-semibold tracking-[-0.02em]">
          Mappa
        </h1>
        {museum?.name && (
          <p className="mt-1 text-xs text-muted-foreground">{museum.name}</p>
        )}
      </header>

      {/* Selettore piano (solo se il museo ha più piani) */}
      {!singleFloor && (
        <div className="flex gap-2 px-5 pt-3.5">
          {floors.map(({ floor: f, label }) => (
            <button
              key={f}
              onClick={() => {
                setFloor(f);
                setActivePin(null);
              }}
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

      {/* Planimetria con i pin del percorso */}
      <div className="px-5 pt-3.5">
        <div className="w-full overflow-auto rounded-2xl border border-border bg-secondary">
          {/* si espande con l'immagine: i pin in % restano allineati */}
          <div className="relative w-[150%]">
            <img
              src={mapSrc}
              alt={singleFloor ? "Mappa del museo" : `Mappa piano ${floor}`}
              className="block w-full max-w-none"
            />
            {pins.map(({ i, s, x, y, dx, dy }) => {
              const isCurrent = i === currentStepIndex;
              const isActive = i === activePin;
              return (
                <button
                  key={i}
                  onClick={() => setActivePin(isActive ? null : i)}
                  title={s.title}
                  style={{
                    left: `${x}%`,
                    top: `${y}%`,
                    // L'offset anti-sovrapposizione è in pixel dentro la transform:
                    // in percentuale dipendeva dalla larghezza della mappa e a 390px
                    // restava più piccolo del pin stesso.
                    transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`,
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
                Tappa {activePin + 1} di {total}
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
                : "Tocca un pin per vedere di che tappa si tratta."}
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

/**
 * Posizione dei pin sul piano corrente. Le tappe che condividono le stesse
 * coordinate vengono disposte su un cerchietto attorno al punto: il raggio è in
 * pixel (i pin sono 32px, la mappa può avere qualsiasi larghezza) e cresce con il
 * numero di tappe del gruppo, così non si toccano mai.
 */
function layoutPins(steps: VisitStep[], floor: number, singleFloor: boolean) {
  const groups = new Map<string, { x: number; y: number; items: { s: VisitStep; i: number }[] }>();

  steps.forEach((s, i) => {
    if (!s.mapCoords) return;
    if (!singleFloor && s.mapCoords.floor !== floor) return;
    const key = `${s.mapCoords.x}-${s.mapCoords.y}`;
    const group = groups.get(key) ?? { x: s.mapCoords.x, y: s.mapCoords.y, items: [] };
    group.items.push({ s, i });
    groups.set(key, group);
  });

  return [...groups.values()].flatMap(({ x, y, items }) => {
    const n = items.length;
    // 22px = raggio del pin (16) + respiro; oltre le ~6 tappe il cerchio si allarga
    // per mantenere la stessa distanza minima fra pin adiacenti.
    const radius = n === 1 ? 0 : Math.max(22, (18 * n) / Math.PI);
    return items.map(({ s, i }, idx) => {
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
