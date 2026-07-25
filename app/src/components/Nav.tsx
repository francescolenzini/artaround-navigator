import { useEffect, useState } from "react";
import { useApp } from "../lib/AppContext";

/**
 * I tre significanti di navigazione dell'handoff "Galleria Bianca". Sostituiscono
 * la tab bar: indietro sempre in alto a sinistra, mappa come overlay globale,
 * account come popover ancorato all'header. Nessuno dei tre introduce una route.
 */

/**
 * Unico modo di dire "indietro" nell'app: freccia senza contenitore + etichetta
 * che nomina la destinazione, così l'utente sa dove sta tornando prima di toccare.
 */
export function BackLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="-ml-1 inline-flex min-h-[44px] items-center gap-2 px-1 text-left"
    >
      <span className="text-[22px] leading-none text-foreground" aria-hidden>
        ‹
      </span>
      <span className="text-[13px] font-semibold text-muted-foreground">{label}</span>
    </button>
  );
}

function MapGlyph({ className }: { className?: string }) {
  // Icona disegnata con i bordi (niente libreria): rettangolo con due pieghe,
  // la stessa forma usata nei mockup.
  return (
    <span
      aria-hidden
      className={`flex h-[15px] w-[19px] shrink-0 overflow-hidden rounded-[3px] border-[1.8px] ${className ?? ""}`}
    >
      <span className="ml-[4.4px] w-[1.4px] bg-current" />
      <span className="ml-[4.4px] w-[1.4px] bg-current" />
    </span>
  );
}

/**
 * Accesso alla mappa: pill compatta pensata per stare nell'header di ogni
 * schermata, accanto all'account (vedi `HeaderActions`).
 */
export function MapPill({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex h-[38px] min-h-[38px] shrink-0 items-center gap-2 rounded-full bg-foreground px-3.5 text-background"
    >
      <MapGlyph className="border-current" />
      <span className="text-xs font-semibold">Mappa</span>
    </button>
  );
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Admin",
  author: "Autore",
  visitor: "Visitatore",
};

/** Iniziali per l'avatar: due dal nome per esteso, altrimenti una dallo username. */
function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Sostituisce la vecchia voce "Account": iniziali nell'header, al tap un popover
 * con nome, ruolo e le due uscite (Editor, logout). Stato locale, nessuna route.
 */
export function AccountMenu() {
  const { user, museum, logout } = useApp();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const displayName = user?.fullName?.trim() || user?.username || "Ospite";
  const roleLabel = user?.role ? (ROLE_LABELS[user.role] ?? user.role) : null;

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Menu account"
        className="flex h-11 w-11 items-center justify-center"
      >
        <span
          className={`flex h-[38px] w-[38px] items-center justify-center rounded-full border font-display text-[13px] font-bold transition-colors ${
            open
              ? "border-foreground bg-foreground text-background"
              : "border-line bg-secondary text-foreground"
          }`}
        >
          {initialsOf(displayName)}
        </span>
      </button>

      {open && (
        <>
          {/* Scrim: cattura il tap fuori e mette in secondo piano la schermata. */}
          <div
            className="fixed inset-0 z-30 bg-foreground/30"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            role="menu"
            className="absolute right-0 top-[46px] z-40 w-[232px] overflow-hidden rounded-2xl border border-border bg-card shadow-[0_22px_48px_-18px_rgba(26,26,24,0.55)]"
          >
            <div className="px-4 pb-3 pt-4">
              <div className="font-display text-[15px] font-semibold leading-tight">
                {displayName}
              </div>
              {roleLabel && (
                <div className="mt-2 inline-flex items-center rounded-full border border-border bg-secondary px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  {roleLabel}
                </div>
              )}
            </div>
            {museum?.marketplaceUrl && (
              <>
                <div className="h-px bg-border" />
                <a
                  href={museum.marketplaceUrl}
                  target="_blank"
                  rel="noreferrer"
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className="flex min-h-[48px] items-center justify-between px-4 text-sm font-semibold"
                >
                  Apri Editor
                  <span className="text-foreground-subtle" aria-hidden>
                    ↗
                  </span>
                </a>
              </>
            )}
            <div className="h-px bg-border" />
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                logout();
              }}
              className="flex min-h-[48px] w-full items-center justify-between px-4 text-sm font-semibold text-primary"
            >
              Esci
              <span className="text-primary/50" aria-hidden>
                ›
              </span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Cluster destro comune a tutte le schermate autenticate: mappa (se applicabile
 * alla schermata) + account, sempre in quest'ordine. Il lato sinistro (BackLink
 * o altro contenuto) resta a carico della route, perché varia da schermata a
 * schermata.
 */
export function HeaderActions({ onMap }: { onMap?: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      {onMap && <MapPill onClick={onMap} />}
      <AccountMenu />
    </div>
  );
}
