/**
 * Search param della mappa. La mappa è un overlay raggiungibile da più schermate:
 * `from` (e `step`, quando si arriva dal player) serve solo a far dire
 * all'indietro dove sta tornando l'utente — la navigazione resta history.back().
 */
export type MapOrigin = "visits" | "visit" | "player";

export interface MapSearch {
  from?: MapOrigin;
  step?: number;
}

const ORIGINS: MapOrigin[] = ["visits", "visit", "player"];

export function parseMapSearch(search: Record<string, unknown>): MapSearch {
  const from = ORIGINS.find((o) => o === search.from);
  const rawStep = Number(search.step);
  const step = Number.isInteger(rawStep) && rawStep >= 0 ? rawStep : undefined;
  return { ...(from ? { from } : {}), ...(step != null ? { step } : {}) };
}

export function backLabelFrom(from?: MapOrigin, step?: number): string {
  if (from === "player" && step != null) {
    return `Torna a Tappa ${String(step + 1).padStart(2, "0")}`;
  }
  if (from === "visit") return "Torna alla visita";
  if (from === "visits") return "Torna alle visite";
  return "Indietro";
}
