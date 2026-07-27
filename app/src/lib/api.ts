import type { ApiConfig } from "./types";

/**
 * Trasforma un percorso relativo servito dal backend (es. "/uploads/upl-...")
 * in URL assoluto anteponendo baseUrl. Gli URL già assoluti passano inalterati.
 */
export function toAbsoluteUrl(baseUrl: string, src: string): string {
  return /^https?:\/\//i.test(src) ? src : `${baseUrl}${src}`;
}

/**
 * Errore applicativo con un messaggio già pronto per l'utente.
 * `message` è sempre leggibile in italiano; `serverMessage`/`raw` conservano il
 * dettaglio tecnico per il debug, senza mai finire a schermo.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly serverMessage?: string;
  readonly raw?: string;

  constructor(status: number, message: string, serverMessage?: string, raw?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.serverMessage = serverMessage;
    this.raw = raw;
  }
}

/** Estrae un messaggio leggibile dal body di errore del backend, se presente. */
function extractServerMessage(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const payload = body as Record<string, unknown>;
  const err = payload.error;
  // Formato del backend ArtAround: { error: { message, status } }
  if (err && typeof err === "object") {
    const message = (err as Record<string, unknown>).message;
    if (typeof message === "string") return message;
  }
  if (typeof err === "string") return err;
  if (typeof payload.message === "string") return payload.message;
  return undefined;
}

/**
 * Traduce uno status HTTP in un messaggio comprensibile in italiano.
 * `status === 0` indica un errore di rete (backend irraggiungibile).
 *
 * Il Navigator è l'app dei visitatori: mostra sempre testi generici, mai il
 * messaggio del backend. Quest'ultimo non è sanitizzato lato server, quindi un
 * errore non gestito arriverebbe a schermo con il suo dettaglio tecnico.
 */
export function friendlyMessage(status: number): string {
  if (status === 0) {
    return "Impossibile contattare il server. Controlla la connessione e riprova.";
  }
  switch (status) {
    case 400:
      return "Richiesta non valida. Controlla i dati inseriti e riprova.";
    case 401:
      return "Sessione scaduta o credenziali non valide. Effettua di nuovo l'accesso.";
    case 403:
      return "Non hai i permessi necessari per questa operazione.";
    case 404:
      return "Contenuto non trovato.";
    case 408:
      return "La richiesta ha impiegato troppo tempo. Riprova.";
    case 409:
      return "Operazione in conflitto con lo stato attuale. Aggiorna e riprova.";
    case 429:
      return "Troppe richieste. Attendi qualche istante e riprova.";
    case 500:
      return "Si è verificato un errore sul server. Riprova più tardi.";
    case 502:
    case 503:
    case 504:
      return "Servizio momentaneamente non disponibile. Riprova più tardi.";
    default:
      if (status >= 500) return "Errore del server. Riprova più tardi.";
      if (status >= 400) return "Si è verificato un errore. Riprova.";
      return "Si è verificato un errore imprevisto. Riprova.";
  }
}

/** Legge il body di una risposta non-ok e ne costruisce un ApiError. */
export async function readError(res: Response, path?: string): Promise<ApiError> {
  const raw = await res.text().catch(() => "");
  let serverMessage: string | undefined;

  if (raw) {
    try {
      serverMessage = extractServerMessage(JSON.parse(raw));
    } catch {
      // Body non-JSON: lo teniamo solo se è testo breve (utile in console).
      // Una pagina HTML di errore del proxy non aggiunge nulla al debug.
      const trimmed = raw.trim();
      if (trimmed && trimmed.length <= 300 && !trimmed.startsWith("<")) {
        serverMessage = trimmed;
      }
    }
  }

  if (import.meta.env.DEV) {
    console.error(`[api] ${res.status} ${path ?? res.url} →`, serverMessage || raw || "(no body)");
  }

  return new ApiError(res.status, friendlyMessage(res.status), serverMessage, raw);
}

/** Ritorna un messaggio pronto per l'utente a partire da un errore qualsiasi. */
export function getErrorMessage(
  err: unknown,
  fallback = "Si è verificato un errore. Riprova.",
): string {
  if (err instanceof ApiError) return err.message;
  // Errore di rete lato fetch (TypeError "Failed to fetch"): mai a schermo.
  if (err instanceof TypeError) return friendlyMessage(0);
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export async function apiFetch<T>(
  cfg: ApiConfig,
  token: string | null,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    "x-api-key": cfg.apiKey,
    "Content-Type": "application/json",
    ...((init.headers as Record<string, string>) ?? {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}${path}`, { ...init, headers });
  } catch {
    // Rete assente, DNS, CORS, backend spento…
    throw new ApiError(0, friendlyMessage(0));
  }

  if (!res.ok) {
    throw await readError(res, path);
  }

  return res.json() as Promise<T>;
}
