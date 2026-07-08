import type { HealthResponse } from "../types.js";

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const contentType = response.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      const payload = await response.json();
      if (typeof payload?.error === "string" && payload.error.length > 0) {
        throw new Error(payload.error);
      }
      if (typeof payload?.message === "string" && payload.message.length > 0) {
        throw new Error(payload.message);
      }
      throw new Error(JSON.stringify(payload));
    }

    const textMessage = await response.text();
    throw new Error(textMessage || `Request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function fetchHealth(apiBaseUrl: string): Promise<HealthResponse> {
  return fetchJson<HealthResponse>(`${apiBaseUrl}/health`);
}

export function money(value: number) {
  return `$${value.toFixed(3)}`;
}
