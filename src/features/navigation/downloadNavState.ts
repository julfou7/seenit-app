import { hasExplicitDownloadError, isDownloadActiveOrAttention, isDownloadCompleted, type DownloadStateLike } from '../downloads/downloadStatePolicy.ts';
export interface NavigationDownload extends DownloadStateLike { id: string; requestId?: string; addedAt?: number }
export type DownloadNavState = { kind: 'none' | 'active' | 'attention' | 'ready'; count: number; label: string };
export const completionKey = (item: NavigationDownload) => `${item.requestId || item.id}:${item.addedAt || ''}`;
export function completedNavigationKeys(items: readonly NavigationDownload[]) {
  return items.filter(item => item.status !== 'warning' && isDownloadCompleted(item)).map(completionKey);
}
export function acknowledgeCompletedDownloads(items: readonly NavigationDownload[]): string[] {
  // Snapshot de la liste courante : pas d'accumulation de tous les anciens transferts.
  return [...new Set(completedNavigationKeys(items))];
}
export function resolveDownloadNavState(items: readonly NavigationDownload[], acknowledged: readonly string[], sourceError = false): DownloadNavState {
  const active = items.filter(item => item.status !== 'waiting' && item.status !== 'warning' && !hasExplicitDownloadError(item) && isDownloadActiveOrAttention(item));
  if (active.length) return { kind: 'active', count: active.length, label: active.length === 1 ? 'Télécharger · en cours' : `Télécharger · ${active.length} en cours` };
  if (sourceError || items.some(item => hasExplicitDownloadError(item) || item.status === 'warning')) return { kind: 'attention', count: 0, label: 'Télécharger · action à faire' };
  const seen = new Set(acknowledged);
  if (completedNavigationKeys(items).some(key => !seen.has(key))) return { kind: 'ready', count: 0, label: 'Télécharger · prêt' };
  return { kind: 'none', count: 0, label: 'Télécharger' };
}
export function readConsultedDownloads(uid: string | null): string[] {
  if (!uid) return [];
  try { const raw = sessionStorage.getItem(`seenit-nav-consulted:${uid}`) || '[]'; if (raw.length > 1_000_000) return []; const parsed: unknown = JSON.parse(raw); return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string') : []; }
  catch { return []; }
}
export function saveConsultedDownloads(uid: string | null, keys: string[]) {
  if (!uid) return;
  try { const snapshot = JSON.stringify(keys); if (snapshot.length <= 1_000_000) sessionStorage.setItem(`seenit-nav-consulted:${uid}`, snapshot); } catch { /* Acquittement mémoire conservé si le stockage est indisponible. */ }
}
