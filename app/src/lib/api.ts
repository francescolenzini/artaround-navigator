import type { ApiConfig } from "./types";

/**
 * Trasforma un percorso relativo servito dal backend (es. "/uploads/upl-...")
 * in URL assoluto anteponendo baseUrl. Gli URL già assoluti passano inalterati.
 */
export function toAbsoluteUrl(baseUrl: string, src: string): string {
  return /^https?:\/\//i.test(src) ? src : `${baseUrl}${src}`;
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
  const res = await fetch(`${cfg.baseUrl}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status}: ${text || res.statusText}`);
  }
  return res.json() as Promise<T>;
}
