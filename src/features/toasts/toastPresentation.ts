export function isDownloadToastPresentation(
  type: string,
  ...texts: Array<string | undefined | null>
): boolean {
  if (type === 'download') return true;
  return texts.some((text) => typeof text === 'string' && /téléchargement/i.test(text));
}

const EPISODE_SUBTITLE = /S(\d+)\s*\|\s*E(\d+)/i;

/**
 * #878 — Ligne de détail d'un toast à taille unique. Le sous-titre se partage : le code d'épisode va sur
 * l'affiche (ou en tête du détail sans affiche) et le reste du contexte (« non vu sur Plex », bilan, type)
 * rejoint le détail, devant l'action. Rien du message d'origine n'est perdu ; l'ellipse coupe au besoin.
 */
export function toastDetailLine({ subtitle, action, hasPoster }: { subtitle?: string; action?: string; hasPoster: boolean }): { episodeBand?: string; detail: string } {
  const episodeMatch = subtitle?.match(EPISODE_SUBTITLE);
  const episodeBand = episodeMatch ? `S${episodeMatch[1].padStart(2, '0')}E${episodeMatch[2].padStart(2, '0')}` : undefined;
  const context = (subtitle || '').replace(EPISODE_SUBTITLE, '').replace(/^[\s•·|:–—-]+|[\s•·|:–—-]+$/g, '');
  const actionText = action || '';
  const detail = [
    hasPoster ? '' : episodeBand,
    context && context !== actionText ? context.charAt(0).toUpperCase() + context.slice(1) : '',
    actionText
  ].filter(Boolean).join(' · ').replace(/\s*\n+\s*/g, ' · ');
  return { episodeBand, detail };
}
