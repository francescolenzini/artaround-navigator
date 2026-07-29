import { useEffect, useRef, type KeyboardEvent } from "react";

interface VisitCompletionDialogProps {
  open: boolean;
  onConfirm: () => void;
  onStay: () => void;
}

export function VisitCompletionDialog({ open, onConfirm, onStay }: VisitCompletionDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement;
    confirmRef.current?.focus();

    return () => {
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, [open]);

  if (!open) return null;

  const keepFocusInside = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onStay();
      return;
    }
    if (event.key !== "Tab") return;

    const controls = Array.from(
      dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") ?? [],
    );
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last) return;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 sm:items-center sm:px-5"
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="visit-completion-title"
        aria-describedby="visit-completion-description"
        onKeyDown={keepFocusInside}
        className="w-full max-w-md rounded-t-3xl bg-card px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-7 text-center text-foreground shadow-2xl sm:rounded-3xl sm:pb-6"
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
          Visita completata
        </p>
        <h2
          id="visit-completion-title"
          className="mt-3 font-display text-2xl font-semibold leading-tight"
        >
          Grazie per aver completato la visita!
        </h2>
        <p
          id="visit-completion-description"
          className="mt-3 text-sm leading-relaxed text-muted-foreground"
        >
          Puoi tornare all&apos;elenco e scegliere un altro percorso, oppure restare su questa
          tappa.
        </p>

        <div className="mt-6 grid gap-2">
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className="min-h-[52px] w-full rounded-xl bg-primary text-base font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          >
            Torna alle visite
          </button>
          <button
            type="button"
            onClick={onStay}
            className="min-h-[48px] w-full rounded-xl border border-line bg-card text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          >
            Resta qui
          </button>
        </div>
      </div>
    </div>
  );
}
