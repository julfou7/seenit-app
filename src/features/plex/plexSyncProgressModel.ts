/**
 * SEENIT-PLEX-012 — Modèle d'avancement d'une synchro Plex, partagé par le backend (qui publie la collecte)
 * et l'app (qui y ajoute ses propres étapes). Un pourcentage n'est jamais inventé : une étape sans total
 * connu ne compte qu'une fois terminée.
 */
export type PlexServerProgressState = 'pending' | 'scanning' | 'done' | 'skipped';

export interface PlexServerProgress {
  id: string;
  name: string;
  owned: boolean;
  state: PlexServerProgressState;
  done: number;
  total: number;
  watched?: number;
  /** #954 : médias de la bibliothèque lus pendant une complète, pour distinguer « peu de vus » et « bibliothèque non lue ». */
  inventory?: number;
  reason?: string;
}

export interface PlexCollectProgress {
  syncId: string;
  mode: 'delta' | 'full';
  state: 'running' | 'done';
  startedAt: number;
  updatedAt: number;
  accountDone: number;
  accountTotal: number;
  enrichDone: number;
  enrichTotal: number;
  servers: PlexServerProgress[];
  percent: number;
}

/** Part de la collecte (backend) dans le pourcentage affiché ; le reste couvre le traitement dans l'app. */
export const PLEX_COLLECT_SHARE = 70;
const ACCOUNT_WEIGHT = 0.15;
const SERVERS_WEIGHT = 0.7;
const ENRICH_WEIGHT = 0.15;

export function serverFraction(server: Pick<PlexServerProgress, 'state' | 'done' | 'total'>): number {
  if (server.state === 'done' || server.state === 'skipped') return 1;
  if (server.state !== 'scanning' || !(server.total > 0)) return 0;
  return Math.min(0.95, Math.max(0, server.done / server.total));
}

/** Fraction 0..1 de la collecte backend : compte Plex, serveurs à parts égales, enrichissement. */
export function collectFraction(progress: Pick<PlexCollectProgress, 'state' | 'accountDone' | 'accountTotal' | 'enrichDone' | 'enrichTotal' | 'servers'>): number {
  if (progress.state === 'done') return 1;
  const account = progress.accountTotal > 0 ? Math.min(1, progress.accountDone / progress.accountTotal) : 0;
  const servers = progress.servers.length ? progress.servers.reduce((sum, server) => sum + serverFraction(server), 0) / progress.servers.length : 0;
  const enrich = progress.enrichTotal > 0 ? Math.min(1, progress.enrichDone / progress.enrichTotal) : 0;
  return ACCOUNT_WEIGHT * account + SERVERS_WEIGHT * servers + ENRICH_WEIGHT * enrich;
}

export interface PlexSyncPercentInput {
  phase: 'collect' | 'resolve' | 'watched' | 'watchlist' | 'save' | 'done' | 'error';
  processed: number;
  total?: number;
  collectPercent?: number;
}

/** Pourcentage global (collecte 70 %, app 30 %), ou `undefined` tant qu'aucun total n'est connu. */
export function overallPlexPercent(progress: PlexSyncPercentInput | undefined): number | undefined {
  if (!progress) return undefined;
  const ratio = progress.total && progress.total > 0 ? Math.min(1, progress.processed / progress.total) : 0;
  switch (progress.phase) {
    case 'collect': return progress.collectPercent === undefined ? undefined : Math.round((Math.min(100, progress.collectPercent) / 100) * PLEX_COLLECT_SHARE);
    case 'resolve': return PLEX_COLLECT_SHARE + 2;
    case 'watched': return Math.round(PLEX_COLLECT_SHARE + 2 + 18 * ratio);
    case 'watchlist': return Math.round(90 + 6 * ratio);
    case 'save': return 97;
    case 'done': return 100;
    default: return undefined;
  }
}

export function formatCompactCount(value: number): string {
  if (!Number.isFinite(value) || value < 1000) return String(Math.max(0, Math.round(value || 0)));
  const thousands = value / 1000;
  return `${thousands >= 100 ? Math.round(thousands) : thousands.toFixed(1).replace('.', ',').replace(/,0$/, '')} k`;
}

/** État court d'un serveur pour une ligne du panneau : jamais d'URL ni de jeton. */
export function serverStatusLabel(server: { state?: PlexServerProgressState; done?: number; total?: number; watched?: number; watchedItems?: number; inventory?: number; inventoryItems?: number; reason?: string }): string {
  if (server.reason) return /délai|hors ligne|timeout/i.test(server.reason) ? 'hors ligne' : 'inaccessible';
  if (server.state === 'skipped') return 'inaccessible';
  if (server.state === 'pending') return 'en attente';
  if (server.state === 'scanning') return server.total && server.total > 0 ? `${Math.round(serverFraction({ state: 'scanning', done: server.done || 0, total: server.total }) * 100)} %` : 'en cours';
  const inventory = server.inventory ?? server.inventoryItems;
  const watched = `${formatCompactCount(server.watched ?? server.watchedItems ?? 0)} vus`;
  // Retour terrain v1.4.297 : « 31 vus sur 14 » se lisait comme une fraction ; les vus comptent aussi l'historique de lecture.
  return inventory && inventory > 0 ? `${watched} · ${formatCompactCount(inventory)} en bibliothèque` : watched;
}
