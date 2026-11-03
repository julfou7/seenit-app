import { collectFraction, type PlexCollectProgress, type PlexServerProgress } from '../plex/plexSyncProgressModel.ts';

/**
 * SEENIT-PLEX-012 — Publication de l'avancement d'une collecte Plex dans
 * `users/{uid}/settings/plexSyncProgress`. Rien n'est écrit avant 2 s (une delta rapide reste sans
 * écriture), puis au plus toutes les 1,5 s ; le pourcentage publié ne recule jamais. Une écriture qui
 * échoue n'interrompt jamais la synchro.
 */
export interface PlexSyncProgressReporterOptions {
  syncId: string | null;
  mode: 'delta' | 'full';
  write: (progress: PlexCollectProgress) => Promise<unknown>;
  now?: () => number;
  minDelayMs?: number;
  throttleMs?: number;
  schedule?: (callback: () => void, delayMs: number) => { cancel: () => void };
}

const defaultSchedule = (callback: () => void, delayMs: number) => {
  const timer = setTimeout(callback, delayMs);
  (timer as { unref?: () => void }).unref?.();
  return { cancel: () => clearTimeout(timer) };
};

export function createPlexSyncProgressReporter(options: PlexSyncProgressReporterOptions) {
  const now = options.now || Date.now;
  const minDelayMs = options.minDelayMs ?? 2000;
  const throttleMs = options.throttleMs ?? 1500;
  const schedule = options.schedule || defaultSchedule;
  const startedAt = now();
  const progress: PlexCollectProgress = { syncId: options.syncId || '', mode: options.mode, state: 'running', startedAt, updatedAt: startedAt, accountDone: 0, accountTotal: options.mode === 'full' ? 3 : 2, enrichDone: 0, enrichTotal: 0, servers: [], percent: 0 };
  let lastWriteAt = 0;
  let wrote = false;
  let timer: { cancel: () => void } | null = null;
  let finished = false;

  const flush = () => {
    timer?.cancel();
    timer = null;
    if (!options.syncId) return;
    progress.percent = Math.max(progress.percent, Math.round(collectFraction(progress) * 100));
    progress.updatedAt = now();
    lastWriteAt = progress.updatedAt;
    wrote = true;
    void options.write({ ...progress, servers: progress.servers.map(server => ({ ...server })) }).catch(() => undefined);
  };
  const touch = () => {
    if (!options.syncId || finished || timer) return;
    const current = now();
    const dueAt = Math.max(startedAt + minDelayMs, lastWriteAt + throttleMs);
    if (current >= dueAt) flush();
    else timer = schedule(flush, dueAt - current);
  };
  const server = (id: string): PlexServerProgress | undefined => progress.servers.find(entry => entry.id === id);

  return {
    snapshot: () => ({ ...progress, servers: progress.servers.map(entry => ({ ...entry })) }),
    accountStep: () => { progress.accountDone = Math.min(progress.accountTotal, progress.accountDone + 1); touch(); },
    setServers: (servers: Array<{ id: string; name: string; owned: boolean }>) => { progress.servers = servers.map(entry => ({ ...entry, state: 'pending', done: 0, total: 0 })); touch(); },
    serverScanning: (id: string) => { const entry = server(id); if (entry && entry.state === 'pending') { entry.state = 'scanning'; touch(); } },
    serverItems: (id: string, items: number, total?: number) => { const entry = server(id); if (!entry) return; entry.done += Math.max(0, items); if (total !== undefined && total > 0) entry.total += total; touch(); },
    serverRestart: (id: string) => { const entry = server(id); if (entry) { entry.done = 0; entry.total = 0; touch(); } },
    serverDone: (id: string, watched: number) => { const entry = server(id); if (entry) { entry.state = 'done'; entry.watched = watched; touch(); } },
    serverSkipped: (id: string, reason: string) => { const entry = server(id); if (entry) { entry.state = 'skipped'; entry.reason = reason; touch(); } },
    setEnrich: (done: number, total: number) => { progress.enrichDone = done; progress.enrichTotal = total; touch(); },
    finish: () => {
      if (finished) return;
      finished = true;
      timer?.cancel();
      timer = null;
      if (!wrote) return;
      progress.state = 'done';
      flush();
    },
  };
}

export type PlexSyncProgressReporter = ReturnType<typeof createPlexSyncProgressReporter>;
