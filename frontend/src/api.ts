/**
 * API configuration — uses VITE_API_URL from environment.
 * Default: http://localhost:8000 for local development.
 */
const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export function getApiUrl(): string {
  return API_BASE.replace(/\/$/, "");
}

export function getWsUrl(path: string): string {
  const base = API_BASE.replace(/^http/, "ws").replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}
