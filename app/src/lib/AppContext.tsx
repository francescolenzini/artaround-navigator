import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type {
  ApiConfig,
  ArtworkMapLocation,
  ArtworkItem,
  AuthUser,
  FloorConfig,
  ListResponse,
  MuseumConfig,
  MuseumData,
  Visit,
} from "./types";
import { getErrorMessage, readError } from "./api";

interface AppState {
  apiConfig: ApiConfig | null;
  museumConfig: MuseumConfig | null;
  museum: MuseumData | null;
  museumReady: boolean;
  loading: boolean;
  error: string | null;
  reload: () => void;
  token: string | null;
  user: AuthUser | null;
  setAuth: (token: string, user: AuthUser) => void;
  logout: () => void;
  // visit context
  visit: Visit | null;
  setVisit: (v: Visit | null) => void;
  currentItem: ArtworkItem | null;
  setCurrentItem: (i: ArtworkItem | null) => void;
}

const Ctx = createContext<AppState | null>(null);

const TOKEN_KEY = "artaround_token";
const USER_KEY = "artaround_user";

function readStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

async function loadJsonConfig(path: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path);
  } catch {
    throw new Error(`Impossibile raggiungere ${path}. Verifica la connessione e riprova.`);
  }

  if (!response.ok) {
    throw new Error(`Impossibile caricare ${path} (HTTP ${response.status}).`);
  }

  try {
    return await response.json();
  } catch {
    throw new Error(`${path} non contiene JSON valido.`);
  }
}

function requireRecord(value: unknown, fileName: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${fileName} deve contenere un oggetto JSON.`);
  }
  return value as Record<string, unknown>;
}

function normalizeApiConfig(value: unknown): ApiConfig {
  const config = requireRecord(value, "api.config.json");
  const apiKey = typeof config.apiKey === "string" ? config.apiKey.trim() : "";
  const rawBaseUrl = typeof config.baseUrl === "string" ? config.baseUrl.trim() : "";

  if (!apiKey || !rawBaseUrl) {
    throw new Error("api.config.json deve definire apiKey e baseUrl non vuoti.");
  }

  let baseUrl: URL;
  try {
    baseUrl = new URL(rawBaseUrl, window.location.origin);
  } catch {
    throw new Error("api.config.json contiene un baseUrl non valido.");
  }
  if (!["http:", "https:"].includes(baseUrl.protocol)) {
    throw new Error("api.config.json deve usare un baseUrl HTTP(S).");
  }

  return { apiKey, baseUrl: rawBaseUrl.replace(/\/+$/, "") };
}

function normalizeMuseumConfig(value: unknown): MuseumConfig {
  const config = requireRecord(value, "museum.config.json");
  const museumSlug = typeof config.museumSlug === "string" ? config.museumSlug.trim() : "";
  const marketplaceUrl =
    typeof config.marketplaceUrl === "string" && config.marketplaceUrl.trim()
      ? config.marketplaceUrl.trim()
      : undefined;
  const floors = config.floors;
  const locations = config.artworkLocations ?? {};

  if (!museumSlug || !Array.isArray(floors) || floors.length === 0) {
    throw new Error("museum.config.json deve definire museumSlug e almeno un piano.");
  }
  if (
    floors.some(
      (floor) =>
        !floor ||
        typeof floor !== "object" ||
        !Number.isFinite((floor as FloorConfig).floor) ||
        typeof (floor as FloorConfig).label !== "string" ||
        !(floor as FloorConfig).label.trim() ||
        typeof (floor as FloorConfig).image !== "string" ||
        !(floor as FloorConfig).image.trim(),
    )
  ) {
    throw new Error("museum.config.json contiene un piano non valido.");
  }
  const typedFloors = floors as MuseumConfig["floors"];
  const floorNumbers = new Set(typedFloors.map((floor) => floor.floor));
  if (floorNumbers.size !== typedFloors.length) {
    throw new Error("museum.config.json contiene numeri di piano duplicati.");
  }
  if (!locations || typeof locations !== "object" || Array.isArray(locations)) {
    throw new Error("museum.config.json contiene posizioni non valide.");
  }
  if (
    Object.values(locations).some(
      (location) =>
        !location ||
        typeof location !== "object" ||
        typeof (location as ArtworkMapLocation).label !== "string" ||
        !(location as ArtworkMapLocation).label.trim() ||
        !Number.isFinite((location as ArtworkMapLocation).floor) ||
        !floorNumbers.has((location as ArtworkMapLocation).floor) ||
        !Number.isFinite((location as ArtworkMapLocation).x) ||
        (location as ArtworkMapLocation).x < 0 ||
        (location as ArtworkMapLocation).x > 100 ||
        !Number.isFinite((location as ArtworkMapLocation).y) ||
        (location as ArtworkMapLocation).y < 0 ||
        (location as ArtworkMapLocation).y > 100,
    )
  ) {
    throw new Error("museum.config.json contiene una posizione non valida.");
  }
  if (marketplaceUrl) {
    try {
      const target = new URL(marketplaceUrl, window.location.origin);
      if (!["http:", "https:"].includes(target.protocol)) throw new Error();
    } catch {
      throw new Error("museum.config.json contiene un marketplaceUrl non valido.");
    }
  }

  return {
    museumSlug,
    ...(marketplaceUrl && { marketplaceUrl }),
    floors: typedFloors,
    artworkLocations: locations as MuseumConfig["artworkLocations"],
  };
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [apiConfig, setApiConfig] = useState<ApiConfig | null>(null);
  const [museumConfig, setMuseumConfig] = useState<MuseumConfig | null>(null);
  const [museum, setMuseum] = useState<MuseumData | null>(null);
  const [museumReady, setMuseumReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState<AuthUser | null>(readStoredUser);
  const [visit, setVisit] = useState<Visit | null>(null);
  const [currentItem, setCurrentItem] = useState<ArtworkItem | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
    setMuseum(null);
    setMuseumReady(false);
  };

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setError(null);
    Promise.all([loadJsonConfig("/api.config.json"), loadJsonConfig("/museum.config.json")])
      .then(([api, museum]) => {
        if (cancel) return;
        setApiConfig(normalizeApiConfig(api));
        setMuseumConfig(normalizeMuseumConfig(museum));
        setMuseum(null);
        setMuseumReady(false);
        if (!localStorage.getItem(TOKEN_KEY)) {
          setLoading(false);
        }
      })
      .catch((e) => {
        if (cancel) return;
        setError(getErrorMessage(e, "Configurazione del museo non disponibile. Riprova."));
        setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [reloadKey]);

  useEffect(() => {
    if (!apiConfig) return;

    let cancel = false;
    const validateToken = async () => {
      if (!token) {
        setLoading(false);
        return;
      }

      setLoading(true);

      try {
        if (museumConfig && !museumReady) {
          const museumSlug = museumConfig.museumSlug;

          const museumResponse = await fetch(
            `${apiConfig.baseUrl}/museums?slug=${encodeURIComponent(museumSlug)}&pageSize=1`,
            {
              headers: {
                "x-api-key": apiConfig.apiKey,
                Authorization: `Bearer ${token}`,
              },
            },
          );

          if (!museumResponse.ok) {
            if (museumResponse.status === 401) {
              logout();
              return;
            }
            throw await readError(museumResponse, "/museums?slug=…");
          }

          const payload = (await museumResponse.json()) as ListResponse<MuseumData>;
          const resolvedMuseum = payload.data?.[0];

          if (!resolvedMuseum) {
            throw new Error(`Museo non trovato per slug ${museumSlug}`);
          }

          setMuseum(resolvedMuseum);
          setMuseumReady(true);
        }

        const response = await fetch(`${apiConfig.baseUrl}/visits?page=1&pageSize=1`, {
          headers: {
            "x-api-key": apiConfig.apiKey,
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          if (response.status === 401) {
            logout();
          } else {
            setError((await readError(response, "/visits")).message);
          }
        }
      } catch (e) {
        if (!cancel) {
          setError(getErrorMessage(e, "Sessione non verificabile. Riprova."));
        }
      } finally {
        if (!cancel) {
          setLoading(false);
        }
      }
    };

    validateToken();

    return () => {
      cancel = true;
    };
  }, [apiConfig, museumConfig, museumReady, token]);

  return (
    <Ctx.Provider
      value={{
        apiConfig,
        museumConfig,
        museum,
        museumReady,
        loading,
        error,
        reload: () => setReloadKey((k) => k + 1),
        token,
        user,
        setAuth: (t, u) => {
          localStorage.setItem(TOKEN_KEY, t);
          localStorage.setItem(USER_KEY, JSON.stringify(u));
          setToken(t);
          setUser(u);
        },
        logout,
        visit,
        setVisit,
        currentItem,
        setCurrentItem,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp must be used within AppProvider");
  return v;
}
