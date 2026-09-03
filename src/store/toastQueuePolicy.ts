export type ToastQueueScope = 'plex';

export interface ScopedToastLike {
  scope?: ToastQueueScope;
  retainOnScopeClear?: boolean;
}

export function filterQueuedToastsByScope<T extends ScopedToastLike>(
  queue: T[],
  scope: ToastQueueScope
): T[] {
  return queue.filter((item) => item.scope !== scope || item.retainOnScopeClear === true);
}

export function normalizePlexNonVuWording(value: string): string {
  return String(value || '')
    .replace(/\bdé-vus?\b/gi, (match) => match.toLowerCase().endsWith('s') ? 'non vus' : 'non vu')
    .replace(/\bnon-vus?\b/gi, (match) => match.toLowerCase().endsWith('s') ? 'non vus' : 'non vu');
}

export function normalizePlexItemAction(action: string, subtitle?: string): string {
  const normalizedAction = normalizePlexNonVuWording(action);
  const normalizedSubtitle = normalizePlexNonVuWording(subtitle || '');

  // Le sous-titre d'un retrait porte déjà le contexte « non vu sur Plex ».
  // Ne jamais lui ajouter l'action contradictoire « Vu sur Plex » ni répéter « non vu ».
  if (/\bnon vu\b[\s\S]*\bplex\b/i.test(normalizedSubtitle)) {
    return 'Synchronisé';
  }

  return normalizedAction;
}

export function normalizePlexCompletionServers(message: string): string {
  const alreadySummarized = message.match(/(\d+)\s+serveur(?:s)?\s+scanné(?:s)?/i);
  if (alreadySummarized) {
    return message.replace(/\s*•\s*Ignorés\s*:[\s\S]*$/i, '').trim();
  }

  const synchronized = message.match(/Synchronisés\s*:\s*(.*?)(?:\s*•\s*Ignorés\s*:|$)/i);
  if (!synchronized) {
    return message.replace(/\s*•\s*Ignorés\s*:[\s\S]*$/i, '').trim();
  }

  const servers = synchronized[1]
    .split(',')
    .map((server) => server.trim())
    .filter(Boolean);
  const count = servers.length;
  const label = count === 1 ? 'serveur scanné' : 'serveurs scannés';
  return `Synchronisation Plex terminée • ${count} ${label}`;
}

export function buildPlexCompletionMessage(
  message: string,
  watched: number,
  unwatched: number
): string {
  const watchedLabel = watched === 1 ? 'vu' : 'vus';
  const unwatchedLabel = unwatched === 1 ? 'non vu' : 'non vus';
  const normalized = normalizePlexCompletionServers(message);
  return `${normalized} • ${watched} ${watchedLabel} • ${unwatched} ${unwatchedLabel}`;
}
