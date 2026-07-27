import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { ApiConfig, ArtworkItem, AuthUser, ListResponse, MuseumConfig, Visit } from "./types";
import { getErrorMessage, readError } from "./api";

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

const TOKEN_KEY = "artaround_token";
const USER_KEY = "artaround_user";

// L'utente va persistito insieme al token: il menu account mostra nome e ruolo,
// che altrimenti sparirebbero al primo reload pur restando la sessione valida.
function readStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [apiConfig, setApiConfig] = useState<ApiConfig | null>(null);
  const [museum, setMuseum] = useState<MuseumConfig | null>(null);
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
            if (museumResponse.status === 401) {
              logout();
              return;
            }
            throw await readError(museumResponse, "/museums?slug=…");
          }

          const payload = (await museumResponse.json()) as ListResponse<{
            id: string;
            coverImage?: string;
          }>;
          const resolvedMuseum = payload.data?.[0];

          if (!resolvedMuseum) {
            throw new Error(`Museo non trovato per slug ${museumSlug}`);
          }

          setMuseum({
            ...museum,
            museumId: resolvedMuseum.id,
            coverImage: resolvedMuseum.coverImage || museum.coverImage,
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
