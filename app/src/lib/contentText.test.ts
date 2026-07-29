// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { effectiveTtsText, supportsTts } from "./contentText";
import type { ArtworkItem } from "./types";

function item(
  screenText?: string,
  ttsText?: string,
  supportsTTS: boolean | undefined = undefined,
): ArtworkItem {
  return {
    id: "item-1",
    artworkId: "art-1",
    content: {
      screenText,
      ttsText,
      rendering: supportsTTS === undefined ? undefined : { supportsTTS },
    },
  };
}

describe("effectiveTtsText", () => {
  it("uses the explicit TTS override", () => {
    expect(effectiveTtsText(item("Testo visibile", "Testo pronunciato"))).toBe("Testo pronunciato");
  });

  it("derives plain text from rich screen content", () => {
    expect(effectiveTtsText(item("<p>Ciao <strong>mondo</strong>.</p><p>Seconda riga.</p>"))).toBe(
      "Ciao mondo.\nSeconda riga.",
    );
  });

  it("uses the step description when the item has no screen text", () => {
    expect(effectiveTtsText(undefined, "<p>Descrizione della tappa</p>")).toBe(
      "Descrizione della tappa",
    );
  });

  it("returns no narration when TTS is disabled", () => {
    const withoutTts = item("Testo visibile", "Override", false);
    expect(supportsTts(withoutTts)).toBe(false);
    expect(effectiveTtsText(withoutTts)).toBe("");
  });
});
