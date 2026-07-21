import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type {
  ApiConfig,
  ArtworkItem,
  AuthUser,
  ListResponse,
  MuseumConfig,
  Visit,
} from "./types";

interface AppState {
  apiConfig: ApiConfig | null;
  museum: MuseumConfig | null;
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

export function AppProvider({ children }: { children: ReactNode }) {
  const [apiConfig, setApiConfig] = useState<ApiConfig | null>(null);
  const [museum, setMuseum] = useState<MuseumConfig | null>(null);
  const [museumReady, setMuseumReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("artaround_token"));
  const [user, setUser] = useState<AuthUser | null>(null);
  const [visit, setVisit] = useState<Visit | null>(null);
  const [currentItem, setCurrentItem] = useState<ArtworkItem | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const logout = () => {
    localStorage.removeItem("artaround_token");
    setToken(null);
    setUser(null);
  };

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setError(null);
    Promise.all([
      fetch("/api.config.json").then((r) => r.json()),
      fetch("/museum.config.json").then((r) => r.json()),
    ])
      .then(([api, mus]) => {
        if (cancel) return;
        setApiConfig(api);
        setMuseum(mus);
        setMuseumReady(false);
        if (!localStorage.getItem("artaround_token")) {
          setLoading(false);
        }
      })
      .catch((e) => {
        if (cancel) return;
        setError(e?.message ?? "Errore caricamento configurazione");
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
        if (museum && !museumReady) {
          const museumSlug = museum.museumSlug;
          if (!museumSlug) {
            throw new Error("Missing museumSlug in museum configuration");
          }

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
            const text = await museumResponse.text().catch(() => "");
            if (museumResponse.status === 401) {
              logout();
              return;
            }
            throw new Error(text || museumResponse.statusText || "Errore risoluzione museo");
          }

          const payload = (await museumResponse.json()) as ListResponse<{ id: string }>;
          const resolvedMuseum = payload.data?.[0];

          if (!resolvedMuseum) {
            throw new Error(`Museo non trovato per slug ${museumSlug}`);
          }

          setMuseum({
            ...museum,
            museumId: resolvedMuseum.id,
          });
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
            const text = await response.text().catch(() => "");
            setError(text || response.statusText || "Errore validazione sessione");
          }
        }
      } catch (e: any) {
        if (!cancel) {
          setError(e?.message ?? "Errore validazione sessione");
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
  }, [apiConfig, token]);

  return (
    <Ctx.Provider
      value={{
        apiConfig,
        museum,
        museumReady,
        loading,
        error,
        reload: () => setReloadKey((k) => k + 1),
        token,
        user,
        setAuth: (t, u) => {
          localStorage.setItem("artaround_token", t);
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
