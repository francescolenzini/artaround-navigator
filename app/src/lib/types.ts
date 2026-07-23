export interface FloorConfig {
  floor: number;
  label: string;
  image: string;
}

export interface MuseumConfig {
  museumSlug: string;
  museumId?: string;
  name: string;
  coverImage: string;
  mapImage: string;
  /** Piani con mappa dedicata. Se assente/vuoto il Navigator usa mapImage come mappa unica. */
  floors?: FloorConfig[];
  marketplaceUrl: string;
  logistics: {
    exit: string;
    toilet: string;
    bar: string;
    shop: string;
    obstacles: string;
  };
}

export interface ApiConfig {
  apiKey: string;
  baseUrl: string;
}

export interface AuthUser {
  id: string;
  username: string;
  role: string;
}

export interface VisitSummary {
  id: string;
  title: string;
  subtitle?: string;
  estimatedDuration?: string;
  estimatedDurationMinutes?: number;
  targetAudience?: string;
}

export type LanguageRegister =
  | "infantile"
  | "elementare"
  | "medio"
  | "avanzato"
  | "specialistico";

/** Scala ordinata dei registri, dal più semplice al più specialistico. */
export const REGISTER_ORDER: LanguageRegister[] = [
  "infantile",
  "elementare",
  "medio",
  "avanzato",
  "specialistico",
];

export interface VisitStep {
  id: string;
  type: "logistics_intro" | "main_item" | "optional_item" | "transition";
  title?: string;
  /** Una tappa = un'opera: al massimo un ArtworkItem.id per registro linguistico. */
  itemsByRegister?: Partial<Record<LanguageRegister, string>>;
  description?: string;
  directionsFromPrevious?: string;
  mapCoords?: { x: number; y: number; floor?: number };
  order?: number;
}

export interface Visit {
  id: string;
  title: string;
  subtitle?: string;
  description?: string;
  estimatedDuration?: string;
  estimatedDurationMinutes?: number;
  targetAudience?: string;
  steps: VisitStep[];
}

export interface ArtworkAsset {
  type?: string;
  source?: string;
  description?: string;
}

export interface Artwork {
  id: string;
  title?: string;
  artist?: string;
  year?: string | number;
  category?: string;
  style?: string;
  description?: string;
  assets?: ArtworkAsset[];
}

export interface ArtworkItem {
  id: string;
  artworkId: string;
  classification?: {
    languageRegister?: string;
    fruitionLength?: string;
  };
  content: {
    title?: string;
    screenText?: string;
    ttsText?: string;
  };
}

export interface ListResponse<T> {
  data: T[];
  pagination?: unknown;
}
