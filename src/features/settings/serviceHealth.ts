import { useEffect, useState } from 'react';
import { resolveSeenItApiUrl } from '../../lib/seenitApi.ts';

/**
 * #404 — « Météo » des services dans Réglages → Connexions. Chaque état vient d'un signal réel et daté :
 * jamais « OK » parce qu'un jeton existe. Le serveur SeenIt est sondé au plus une fois toutes les
 * 5 minutes via `/api/health` (aucune clé tierce exposée, aucun fan-out vers TMDB/TVDB/OMDb).
 */
export type ServiceTone = 'ok' | 'warn' | 'error' | 'busy';
export interface ServiceState { text: string; tone?: ServiceTone }

export interface BackendProbe { ok: boolean; ms: number; at: number }

export const BACKEND_HEALTH_TTL_MS = 5 * 60 * 1000;
export const BACKEND_SLOW_MS = 2_500;
const BACKEND_TIMEOUT_MS = 8_000;

let cachedProbe: BackendProbe | null = null;
let inFlight: Promise<BackendProbe> | null = null;

export function describeBackendHealth(probe: BackendProbe | null): ServiceState {
  if (!probe) return { text: 'Vérification…', tone: 'busy' };
  if (!probe.ok) return { text: 'Injoignable · réessaie dans un instant', tone: 'error' };
  if (probe.ms >= BACKEND_SLOW_MS) return { text: `Lent · ${Math.round(probe.ms / 100) / 10} s`, tone: 'warn' };
  return { text: 'Opérationnel', tone: 'ok' };
}

export function describeNotificationHealth(permission: string): ServiceState {
  if (permission === 'granted') return { text: 'Autorisées', tone: 'ok' };
  if (permission === 'denied') return { text: 'Bloquées par le système', tone: 'error' };
  return { text: 'À autoriser', tone: 'warn' };
}

export async function probeBackendHealth(
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
  url: string = resolveSeenItApiUrl('/api/health'),
): Promise<BackendProbe> {
  const started = now();
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS) : null;
  try {
    const response = await fetchImpl(url, { cache: 'no-store', signal: controller?.signal });
    const body = response.ok ? await response.json().catch(() => null) as { status?: unknown } | null : null;
    return { ok: response.ok && body?.status === 'ok', ms: now() - started, at: now() };
  } catch {
    return { ok: false, ms: now() - started, at: now() };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Sonde partagée : un seul appel en vol, résultat réutilisé pendant BACKEND_HEALTH_TTL_MS. */
export function readBackendHealth(
  probe: () => Promise<BackendProbe> = probeBackendHealth,
  now: () => number = Date.now,
): Promise<BackendProbe> {
  if (cachedProbe && now() - cachedProbe.at < BACKEND_HEALTH_TTL_MS) return Promise.resolve(cachedProbe);
  inFlight ??= probe().then(result => { cachedProbe = result; return result; }).finally(() => { inFlight = null; });
  return inFlight;
}

export function resetBackendHealthCache(): void { cachedProbe = null; inFlight = null; }

export function useBackendHealth(): ServiceState {
  const [probe, setProbe] = useState<BackendProbe | null>(cachedProbe);
  useEffect(() => {
    let alive = true;
    void readBackendHealth().then(result => { if (alive) setProbe(result); });
    return () => { alive = false; };
  }, []);
  return describeBackendHealth(probe);
}
