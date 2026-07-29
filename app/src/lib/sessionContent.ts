import type { ArtworkItem, Visit } from "./types";

export function clearSessionContent(
  setVisit: (visit: Visit | null) => void,
  setCurrentItem: (item: ArtworkItem | null) => void,
) {
  setVisit(null);
  setCurrentItem(null);
}
