import { describe, expect, it } from "vitest";
import { formatLogisticsToast } from "./logisticsToast";

describe("formatLogisticsToast", () => {
  it("restituisce solo il corpo del messaggio logistico", () => {
    expect(formatLogisticsToast("L'uscita principale si trova al piano terra.")).toBe(
      "L'uscita principale si trova al piano terra.",
    );
  });

  it("ripiega su un messaggio di disponibilità generico quando manca il testo", () => {
    expect(formatLogisticsToast("   ")).toBe("Informazione non disponibile per questo museo");
    expect(formatLogisticsToast(undefined)).toBe("Informazione non disponibile per questo museo");
  });
});
