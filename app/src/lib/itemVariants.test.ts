import { describe, expect, it } from "vitest";
import { buildGrid, durationLabel, neighbour, parseMinutes, resolveVariant } from "./itemVariants";
import type { ArtworkItem } from "./types";

/** Item minimo: contano solo registro e durata, il resto è rumore per questi test. */
function item(register: string, fruitionLength?: string, extra?: { seconds?: number }): ArtworkItem {
  return {
    id: `${register}-${fruitionLength ?? "na"}-${extra?.seconds ?? ""}`,
    artworkId: "art-1",
    classification: {
      languageRegister: register,
      fruitionLength,
      targetDurationSeconds: extra?.seconds,
    },
    content: { title: `${register} ${fruitionLength}` },
  };
}

// Griglia delle opere vetrina del seed, in piccolo: elementare e medio con due
// durate, avanzato con una sola, infantile solo breve.
const SEED_LIKE = [
  item("infantile", "1min"),
  item("elementare", "1min"),
  item("elementare", "4min"),
  item("medio", "1min"),
  item("medio", "4min"),
  item("avanzato", "4min"),
];

describe("parseMinutes", () => {
  it("legge i minuti dichiarati", () => {
    expect(parseMinutes(item("medio", "4min"))).toBe(4);
  });

  it("accetta i valori storici in secondi", () => {
    expect(parseMinutes(item("medio", "30s"))).toBe(0.5);
  });

  it("ripiega sulla stima da conteggio parole quando la durata manca", () => {
    expect(parseMinutes(item("medio", undefined, { seconds: 120 }))).toBe(2);
  });

  it("non scarta un item con durata malformata", () => {
    expect(parseMinutes(item("medio", "quattro minuti"))).toBe(0);
  });
});

describe("buildGrid", () => {
  it("ordina i registri per scala e le durate per minuti", () => {
    const grid = buildGrid(SEED_LIKE);
    expect(grid.registers).toEqual(["infantile", "elementare", "medio", "avanzato"]);
    expect(grid.durations).toEqual([1, 4]);
    expect(grid.variants).toHaveLength(6);
  });

  it("scarta gli item senza un registro riconoscibile", () => {
    const grid = buildGrid([item("medio", "1min"), item("gergale", "1min")]);
    expect(grid.variants).toHaveLength(1);
  });

  it("regge una tappa senza varianti", () => {
    const grid = buildGrid([]);
    expect(grid.variants).toEqual([]);
    expect(resolveVariant(grid, { register: "medio", minutes: 1 })).toBeNull();
  });
});

describe("resolveVariant", () => {
  const grid = buildGrid(SEED_LIKE);

  it("prende la cella esatta quando esiste", () => {
    const v = resolveVariant(grid, { register: "medio", minutes: 4 });
    expect(v?.register).toBe("medio");
    expect(v?.minutes).toBe(4);
  });

  it("parte dalla variante più breve quando la durata non è ancora scelta", () => {
    const v = resolveVariant(grid, { register: "elementare", minutes: null });
    expect(v?.minutes).toBe(1);
  });

  it("tiene il registro e adatta la durata se la cella manca", () => {
    const v = resolveVariant(grid, { register: "avanzato", minutes: 1 });
    expect(v?.register).toBe("avanzato");
    expect(v?.minutes).toBe(4);
  });

  it("ripiega sul registro più vicino quando quello preferito manca", () => {
    const v = resolveVariant(grid, { register: "specialistico", minutes: 4 });
    expect(v?.register).toBe("avanzato");
  });

  it("a parità di distanza sceglie il registro più semplice", () => {
    // 'medio' assente: elementare e avanzato lo circondano a distanza 1, e in
    // pareggio si spiazza verso il basso.
    const sparse = buildGrid([item("elementare", "1min"), item("avanzato", "1min")]);
    expect(resolveVariant(sparse, { register: "medio", minutes: 1 })?.register).toBe("elementare");
  });

  it("sceglie il registro davvero più vicino, non il più semplice in assoluto", () => {
    // 'avanzato' dista 1 da 'medio', 'infantile' ne dista 2: la vicinanza viene
    // prima della preferenza per il registro basso.
    const sparse = buildGrid([item("infantile", "1min"), item("avanzato", "1min")]);
    expect(resolveVariant(sparse, { register: "medio", minutes: 1 })?.register).toBe("avanzato");
  });
});

describe("neighbour — asse durata", () => {
  const grid = buildGrid(SEED_LIKE);
  const medio1 = resolveVariant(grid, { register: "medio", minutes: 1 })!;
  const medio4 = resolveVariant(grid, { register: "medio", minutes: 4 })!;

  it('"dimmi di più" allunga tenendo fermo il registro', () => {
    const next = neighbour(grid, medio1, "duration", 1);
    expect(next?.register).toBe("medio");
    expect(next?.minutes).toBe(4);
  });

  it('"dimmi di meno" accorcia tenendo fermo il registro', () => {
    const prev = neighbour(grid, medio4, "duration", -1);
    expect(prev?.minutes).toBe(1);
  });

  it("non salta di registro quando la durata è satura", () => {
    // In 'medio' non c'è nulla oltre i 4 minuti: la risposta corretta è "non
    // c'è", non un testo di un altro registro che sarebbe la confusione fra i
    // due assi che il modulo esiste per togliere.
    expect(neighbour(grid, medio4, "duration", 1)).toBeNull();
  });

  it("è null anche in un registro con una sola durata", () => {
    const avanzato = resolveVariant(grid, { register: "avanzato", minutes: 4 })!;
    expect(neighbour(grid, avanzato, "duration", 1)).toBeNull();
    expect(neighbour(grid, avanzato, "duration", -1)).toBeNull();
  });
});

describe("neighbour — asse registro", () => {
  const grid = buildGrid(SEED_LIKE);

  it('"troppo semplice" sale di registro tenendo la durata', () => {
    const elementare4 = resolveVariant(grid, { register: "elementare", minutes: 4 })!;
    const next = neighbour(grid, elementare4, "register", 1);
    expect(next?.register).toBe("medio");
    expect(next?.minutes).toBe(4);
  });

  it('"non capisco" scende di registro tenendo la durata', () => {
    const medio1 = resolveVariant(grid, { register: "medio", minutes: 1 })!;
    const prev = neighbour(grid, medio1, "register", -1);
    expect(prev?.register).toBe("elementare");
    expect(prev?.minutes).toBe(1);
  });

  it("scavalca i registri assenti dalla tappa", () => {
    const sparse = buildGrid([item("elementare", "1min"), item("specialistico", "4min")]);
    const elementare = resolveVariant(sparse, { register: "elementare", minutes: 1 })!;
    expect(neighbour(sparse, elementare, "register", 1)?.register).toBe("specialistico");
  });

  it("accetta di cambiare durata pur di onorare il registro richiesto", () => {
    // Il registro è "chi sono io" e va rispettato; la durata è "quanto tempo
    // ho" ed è un'approssimazione. Qui 'avanzato' esiste solo a 4 minuti.
    const medio1 = resolveVariant(grid, { register: "medio", minutes: 1 })!;
    const next = neighbour(grid, medio1, "register", 1);
    expect(next?.register).toBe("avanzato");
    expect(next?.minutes).toBe(4);
  });

  it("è null agli estremi della scala presente nella tappa", () => {
    const infantile = resolveVariant(grid, { register: "infantile", minutes: 1 })!;
    expect(neighbour(grid, infantile, "register", -1)).toBeNull();
    const avanzato = resolveVariant(grid, { register: "avanzato", minutes: 4 })!;
    expect(neighbour(grid, avanzato, "register", 1)).toBeNull();
  });
});

describe("durationLabel", () => {
  it("usa i minuti sopra il minuto", () => {
    expect(durationLabel(4)).toBe("≈4 min");
  });

  it("scende ai secondi sotto il minuto", () => {
    expect(durationLabel(0.5)).toBe("≈30 s");
  });

  it("non inventa un tempo quando il dato manca", () => {
    expect(durationLabel(0)).toBe("durata non indicata");
  });
});
