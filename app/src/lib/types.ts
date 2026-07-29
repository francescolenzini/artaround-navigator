export interface FloorConfig {
  floor: number;
  label: string;
  image: string;
}

export interface ArtworkMapLocation {
  label: string;
  floor: number;
  x: number;
  y: number;
}

export interface MuseumConfig {
  museumSlug: string;
  marketplaceUrl?: string;
  floors: FloorConfig[];
  /** Posizioni statiche, indicizzate dalla chiave restituita da una tappa. */
  artworkLocations?: Record<string, ArtworkMapLocation>;
}

export interface MuseumLogistics {
  exit: string;
  toilet?: string;
  bar?: string;
  shop?: string;
  obstacles?: string;
}

export interface MuseumData {
  id: string;
  name: string;
  coverImage?: string;
  logistics: MuseumLogistics;
  defaultLanguage: string;
  supportedLanguages: string[];
}

export interface ApiConfig {
  apiKey: string;
  baseUrl: string;
}

export interface AuthUser {
  id: string;
  /** Nome per esteso: mostrato nel menu account, da cui si ricavano le iniziali. */
  fullName?: string;
  username: string;
  role: string;
}

export interface VisitSummary {
  id: string;
  title: string;
  subtitle?: string;
  estimatedDurationMinutes?: number;
  targetAudience?: string;
  coverImage?: string;
}

export type LanguageRegister = "infantile" | "elementare" | "medio" | "avanzato" | "specialistico";

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
  /**
   * Una tappa = un'opera, con tutte le sue varianti disponibili in visita.
   * Registro e durata di ciascuna si leggono da `ArtworkItem.classification`:
   * la griglia dei due assi la costruisce `lib/itemVariants.ts`, non lo step.
   */
  artworkId?: string;
  itemIds?: string[];
  /** Variante editoriale proposta al primo ingresso, prima della preferenza del visitatore. */
  defaultItemId?: string;
  /** Compatibilità con le visite salvate prima dell’introduzione di defaultItemId. */
  defaultRegister?: LanguageRegister;
  description?: string;
  /** Chiave stabile per cercare la posizione in museum.config.json. */
  artworkMapKey?: string;
  order?: number;
}

export interface Visit {
  id: string;
  title: string;
  subtitle?: string;
  description?: string;
  estimatedDurationMinutes?: number;
  targetAudience?: string;
  coverImage?: string;
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
    /** Durata dichiarata dall'autore, formato `{n}min` (o `{n}s` per i valori storici). */
    fruitionLength?: string;
    /** Stima dell'Editor dal conteggio parole: ripiego quando `fruitionLength` manca. */
    targetDurationSeconds?: number;
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
