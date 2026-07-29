import type { ArtworkItem } from "./types";
import { richTextToPlain } from "./richtext";

/**
 * Testo realmente pronunciato dal player. `ttsText` è un override editoriale;
 * quando manca, il testo a schermo resta l'unica fonte canonica.
 */
export function effectiveTtsText(
  item: ArtworkItem | null | undefined,
  fallbackScreenText = "",
): string {
  if (item?.content.rendering?.supportsTTS === false) return "";
  const override = item?.content.ttsText?.trim();
  if (override) return override;
  return richTextToPlain(item?.content.screenText ?? fallbackScreenText).trim();
}

export function supportsTts(item: ArtworkItem | null | undefined): boolean {
  return item?.content.rendering?.supportsTTS !== false;
}
