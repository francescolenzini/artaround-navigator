import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Tendina dei comandi secondari del player: emerge da dietro la maniglia
 * verso l'alto, senza mai coprire la riga di navigazione (che resta fuori,
 * fissa nel footer). Apre/chiude con tap o swipe sulla maniglia, oltre che
 * con lo scrim e `Escape`.
 *
 * Il pannello è una fascia a filo dei bordi del contenitore, con bordo
 * superiore squadrato: un raggio lascerebbe due angoli trasparenti affacciati
 * sullo scrim, che si leggono come un difetto di rendering invece che come una
 * scelta. Il distacco dal contenuto lo danno il filo e l'ombra verso l'alto.
 *
 * `scrimContainer` è il nodo in cui montare il velo: serve perché lo scrim va
 * confinato alla shell `max-w-md` del player (già `overflow-hidden`) e non al
 * viewport — altrimenti su schermi larghi oscura anche le bande fuori dalla
 * shell. Un `position: fixed` non può conoscere quella geometria, quindi lo
 * scrim viene portato lì con un portale, tenendo dentro questo componente
 * tutta la logica di chiusura.
 */
export function CommandSheet({
  open,
  onOpenChange,
  label,
  scrimContainer,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  scrimContainer?: HTMLElement | null;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  // Soglia di 40px: sotto, è un tap gestito dal click nativo del bottone;
  // sopra, è uno swipe che decide subito lui l'apertura/chiusura e marca
  // `dragged` per far ignorare il click sintetico che segue.
  const dragStartY = useRef<number | null>(null);
  const dragged = useRef(false);

  return (
    <div className="relative pt-3.5">
      {open &&
        scrimContainer &&
        createPortal(
          <div
            className="absolute inset-0 z-30 bg-scrim backdrop-blur-[3px]"
            onClick={() => onOpenChange(false)}
            aria-hidden
          />,
          scrimContainer,
        )}

      <div
        id="command-sheet"
        className={`absolute inset-x-0 bottom-full z-40 grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none ${
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
        inert={!open}
      >
        <div className="overflow-hidden">
          <div className="max-h-[52dvh] overflow-y-auto overscroll-contain border-t border-line bg-card px-5 pb-4 pt-4 shadow-sheet">
            {children}
          </div>
        </div>
      </div>

      <button
        type="button"
        aria-expanded={open}
        aria-controls="command-sheet"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          dragStartY.current = e.clientY;
        }}
        onPointerUp={(e) => {
          const startY = dragStartY.current;
          dragStartY.current = null;
          if (startY == null) return;
          const delta = startY - e.clientY;
          if (Math.abs(delta) < 40) return;
          dragged.current = true;
          onOpenChange(delta > 0);
        }}
        onClick={() => {
          if (dragged.current) {
            dragged.current = false;
            return;
          }
          onOpenChange(!open);
        }}
        className="relative z-40 flex min-h-[44px] w-full items-center justify-center gap-2 px-5 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle"
      >
        <span>{label}</span>
        <span
          aria-hidden
          className={`h-1.5 w-1.5 border-l-2 border-t-2 border-current transition-transform duration-300 ${
            open ? "rotate-[-135deg]" : "rotate-45"
          }`}
        />
      </button>
    </div>
  );
}
