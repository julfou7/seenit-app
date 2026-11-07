export function isDownloadToastPresentation(
  type: string,
  ...texts: Array<string | undefined | null>
): boolean {
  if (type === 'download') return true;
  return texts.some((text) => typeof text === 'string' && /téléchargement/i.test(text));
}

const EPISODE_SUBTITLE = /S(\d+)\s*\|\s*E(\d+)/i;

/**
 * #878 — Ligne de détail d'un toast. Le sous-titre se partage : le code d'épisode devient la pastille
 * « S01 | E03 » du toast d'épisode (comme avant #878, retour terrain du 07/11) et le reste du contexte
 * (« non vu sur Plex », bilan, type) rejoint le détail, devant l'action. Rien du message d'origine n'est perdu.
 */
export function toastDetailLine({ subtitle, action }: { subtitle?: string; action?: string }): { episodeLabel?: string; detail: string } {
  const episodeMatch = subtitle?.match(EPISODE_SUBTITLE);
  const episodeLabel = episodeMatch ? `S${episodeMatch[1].padStart(2, '0')} | E${episodeMatch[2].padStart(2, '0')}` : undefined;
  const context = (subtitle || '').replace(EPISODE_SUBTITLE, '').replace(/^[\s•·|:–—-]+|[\s•·|:–—-]+$/g, '');
  const actionText = action || '';
  const detail = [
    context && context !== actionText ? context.charAt(0).toUpperCase() + context.slice(1) : '',
    actionText
  ].filter(Boolean).join(' · ').replace(/\s*\n+\s*/g, ' · ');
  return { episodeLabel, detail };
}
