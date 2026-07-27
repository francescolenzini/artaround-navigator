import { REGISTER_ORDER, type ArtworkItem, type LanguageRegister } from "./types";

/**
 * Le due dimensioni dell'item, e come ci si muove sopra.
 *
 * Le specifiche caratterizzano un item "almeno" per lunghezza (3s/15s/1min/4min)
 * e per linguaggio (infantile…specialistico): due assi, non uno. Da qui i due
 * comandi vocali che altrimenti sarebbero sinonimi —
 *
 *   "dimmi di più" / "dimmi di meno"      → asse durata, registro fermo
 *   "troppo semplice" / "non capisco"     → asse registro, durata quasi ferma
 *
 * L'asse registro è una scala ordinale fissa (REGISTER_ORDER). L'asse durata
 * non ha scala predefinita: i gradini sono i minuti che l'autore ha davvero
 * caricato per quella tappa. Niente soglie tipo "breve/medio/lungo" — una
 * tappa con varianti da 1, 2 e 4 minuti ha tre gradini, una con 1 e 4 ne ha due.
 *
 * Il modulo è puro: nessun React, nessuna rete. Tutta la selezione della
 * variante vive qui, così il player si limita a chiedere "spostati di uno".
 */

export interface Variant {
  item: ArtworkItem;
  register: LanguageRegister;
  minutes: number;
}

export interface VariantGrid {
  variants: Variant[];
  /** Registri presenti nella tappa, dal più semplice al più specialistico. */
  registers: LanguageRegister[];
  /** Durate presenti nella tappa, in minuti crescenti. */
  durations: number[];
}

export interface VariantPref {
  register: LanguageRegister | null;
  minutes: number | null;
}

export type VariantAxis = "register" | "duration";

const EMPTY_GRID: VariantGrid = { variants: [], registers: [], durations: [] };

// Stessa forma accettata da fruitionToMinutes nell'Editor
// (services/editor/app/constants.js): i due runtime sono separati e non
// condividono un package, quindi la regex è duplicata di proposito — se cambia
// una, va cambiata l'altra.
const FRUITION_RE = /^(\d+(?:\.\d+)?)(s|min)$/;

/**
 * Durata di un item in minuti. `fruitionLength` è il dato dichiarato
 * dall'autore; se manca o è malformato si ripiega sulla stima calcolata dal
 * conteggio parole (`targetDurationSeconds`, popolata dall'Editor), che è
 * comunque meglio di un valore inventato. Se non c'è nessuno dei due l'item
 * vale 0 minuti: resta selezionabile, semplicemente si colloca all'inizio
 * della scala invece di sparire dalla tappa.
 */
export function parseMinutes(item: ArtworkItem): number {
  const raw = item.classification?.fruitionLength;
  const match = typeof raw === "string" ? raw.trim().match(FRUITION_RE) : null;
  if (match) {
    const value = Number(match[1]);
    if (Number.isFinite(value)) return match[2] === "s" ? value / 60 : value;
  }

  const seconds = item.classification?.targetDurationSeconds;
  if (typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0) {
    return seconds / 60;
  }

  return 0;
}

function isRegister(value: unknown): value is LanguageRegister {
  return typeof value === "string" && (REGISTER_ORDER as string[]).includes(value);
}

/**
 * Griglia della tappa a partire dagli item caricati. Gli item senza un registro
 * riconoscibile vengono scartati: senza registro non hanno posizione su nessuno
 * dei due assi, e mostrarli renderebbe i comandi imprevedibili.
 */
export function buildGrid(items: ArtworkItem[]): VariantGrid {
  const variants: Variant[] = [];
  for (const item of items) {
    const register = item.classification?.languageRegister;
    if (!isRegister(register)) continue;
    variants.push({ item, register, minutes: parseMinutes(item) });
  }
  if (!variants.length) return EMPTY_GRID;

  const registers = REGISTER_ORDER.filter((r) => variants.some((v) => v.register === r));
  const durations = [...new Set(variants.map((v) => v.minutes))].sort((a, b) => a - b);

  return { variants, registers, durations };
}

function variantsOf(grid: VariantGrid, register: LanguageRegister): Variant[] {
  return grid.variants.filter((v) => v.register === register).sort((a, b) => a.minutes - b.minutes);
}

/** Variante di `register` con la durata più vicina a `minutes`; a parità, la più breve. */
function closestByDuration(candidates: Variant[], minutes: number | null): Variant | null {
  if (!candidates.length) return null;
  if (minutes == null) return candidates[0];

  let best = candidates[0];
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const distance = Math.abs(candidate.minutes - minutes);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Variante da mostrare per una preferenza di sessione.
 *
 * Se la cella esatta non esiste si sceglie la più vicina, misurando la distanza
 * sugli **indici** dei due assi e non sui valori grezzi: un salto di registro e
 * un salto di durata pesano uguale, altrimenti i minuti (numeri grandi)
 * dominerebbero la scala dei registri (numeri da 0 a 4). A parità vince il
 * registro più semplice e la durata più breve — meglio spiazzare verso il
 * basso che verso l'alto.
 *
 * La griglia è irregolare per costruzione (nessun autore scrive tutte le celle),
 * quindi questo è il caso normale, non la gestione di un errore.
 */
export function resolveVariant(grid: VariantGrid, pref: VariantPref): Variant | null {
  if (!grid.variants.length) return null;

  const targetRegister = isRegister(pref.register) ? pref.register : "medio";

  // Il registro è la preferenza forte: se la tappa lo copre, si resta lì e si
  // adatta solo la durata. Vale anche al primo ingresso, quando la durata non è
  // ancora stata scelta: si parte dalla più breve e sarà "dimmi di più" ad
  // allungare, non il contrario.
  const inTargetRegister = variantsOf(grid, targetRegister);
  if (inTargetRegister.length) return closestByDuration(inTargetRegister, pref.minutes);

  // Registro assente dalla tappa: si cerca in due dimensioni, misurando la
  // distanza sugli indici dei due assi e non sui valori grezzi — un salto di
  // registro e un salto di durata devono pesare uguale, altrimenti i minuti
  // (numeri grandi) schiaccerebbero la scala dei registri (indici 0-4).
  const registerIndex = (r: LanguageRegister) => REGISTER_ORDER.indexOf(r);
  const durationIndex = (m: number) => {
    let best = 0;
    let bestDistance = Infinity;
    grid.durations.forEach((duration, index) => {
      const distance = Math.abs(duration - m);
      if (distance < bestDistance) {
        best = index;
        bestDistance = distance;
      }
    });
    return best;
  };

  const targetRegisterIndex = registerIndex(targetRegister);
  const targetDurationIndex = pref.minutes == null ? 0 : durationIndex(pref.minutes);
  const score = (variant: Variant) =>
    Math.abs(registerIndex(variant.register) - targetRegisterIndex) +
    Math.abs(durationIndex(variant.minutes) - targetDurationIndex);

  // A parità di distanza vince il registro più semplice, poi la durata più
  // breve: meglio spiazzare l'utente verso il basso che verso l'alto.
  return [...grid.variants].sort(
    (a, b) =>
      score(a) - score(b) ||
      registerIndex(a.register) - registerIndex(b.register) ||
      a.minutes - b.minutes,
  )[0];
}

/**
 * Variante raggiunta muovendosi di un gradino su un asse, o `null` se l'asse è
 * saturo in quella direzione.
 *
 * I due assi non sono simmetrici, ed è voluto:
 *
 * - **registro**: il gradino di registro va sempre onorato, perché è "chi sono
 *   io"; se il nuovo registro non ha la durata corrente si prende la sua durata
 *   più vicina. Meglio un racconto un po' più lungo del previsto che un rifiuto.
 * - **durata**: si resta dentro lo stesso registro. Rispondere a "dimmi di più"
 *   con un testo specialistico sarebbe esattamente la confusione fra i due assi
 *   che questo modulo esiste per togliere: se non c'è una versione più lunga in
 *   questo registro, la risposta corretta è "non c'è".
 */
export function neighbour(
  grid: VariantGrid,
  current: Variant,
  axis: VariantAxis,
  dir: 1 | -1,
): Variant | null {
  if (axis === "register") {
    const from = REGISTER_ORDER.indexOf(current.register);
    const candidates =
      dir === 1 ? REGISTER_ORDER.slice(from + 1) : REGISTER_ORDER.slice(0, from).reverse();
    for (const register of candidates) {
      const inRegister = variantsOf(grid, register);
      if (inRegister.length) return closestByDuration(inRegister, current.minutes);
    }
    return null;
  }

  const sameRegister = variantsOf(grid, current.register);
  const index = sameRegister.findIndex((v) => v.item.id === current.item.id);
  if (index < 0) return null;
  return sameRegister[index + dir] ?? null;
}

const REGISTER_LABELS: Record<LanguageRegister, string> = {
  infantile: "Infantile",
  elementare: "Elementare",
  medio: "Medio",
  avanzato: "Avanzato",
  specialistico: "Specialistico",
};

export function registerLabel(register: LanguageRegister): string {
  return REGISTER_LABELS[register];
}

/**
 * Durata leggibile. Sotto il minuto si passa ai secondi arrotondati ai 5, e lo
 * "≈" resta sempre: `fruitionLength` è una stima dell'autore, non un tempo
 * misurato — speechSynthesis non espone la durata reale di un'utterance.
 */
export function durationLabel(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "durata non indicata";
  if (minutes < 1) return `≈${Math.max(5, Math.round((minutes * 60) / 5) * 5)} s`;
  return `≈${Math.round(minutes)} min`;
}
