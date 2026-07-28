import { useEffect, useRef, type ReactNode } from "react";

/**
 * Tendina dei comandi secondari del player: si apre verso il BASSO, subito
 * sotto la propria etichetta, e resta un elemento in flusso invece di un
 * pannello sovrapposto. Apre/chiude con tap o swipe sulla maniglia, oltre che
 * con `Escape`.
 *
 * Crescendo in flusso dentro il footer, la tendina restringe il contenuto della
 * tappa (`main` è `flex-1 min-h-0`) invece di coprirlo, e la riga di navigazione
 * resta al suo posto sotto di lei. È il motivo per cui non c'è nessun velo:
 * niente è sovrapposto, quindi non c'è niente da separare oscurando il resto
 * della schermata. Il distacco lo danno la superficie leggermente diversa dal
 * footer e i due fili sopra e sotto.
 */
export function CommandSheet({
  open,
  onOpenChange,
  label,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
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
  // `dragged` per far ignorare il click sintetico che segue. Il verso è quello
  // dell'apertura: si trascina in giù per aprire, in su per chiudere.
  const dragStartY = useRef<number | null>(null);
  const dragged = useRef(false);

  return (
    // Nessun padding qui sopra: lo stacco fra il filo del footer e l'etichetta
    // lo dà già la metà superiore del bottone (44px di altezza minima attorno a
    // una riga di testo). Aggiungerne dell'altro rendeva l'aria sopra la scritta
    // il doppio di quella sotto.
    <div>
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
          const delta = e.clientY - startY;
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
        className="flex min-h-[44px] w-full items-center justify-center gap-2 px-5 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle"
      >
        <span>{label}</span>
        <span
          aria-hidden
          className={`h-1.5 w-1.5 border-l-2 border-t-2 border-current transition-transform duration-300 ${
            open ? "rotate-[-135deg]" : "rotate-45"
          }`}
        />
      </button>

      <div
        id="command-sheet"
        className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none ${
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
        inert={!open}
      >
        <div className="overflow-hidden">
          <div className="border-y border-line bg-surface-muted px-5 pb-3 pt-3">{children}</div>
        </div>
      </div>
    </div>
  );
}
