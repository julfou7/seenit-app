import type { Show } from '../../types';
import type { ToastMessageObj } from '../../store/toastStore';

export interface ReminderToastCandidate {
  key: string;
  title: string;
  body: string;
  posterPath?: string | null;
  show?: Show;
  /** Canal Android de la notification équivalente (#402) : une bannière suit le même choix. */
  channelId?: string;
}

/**
 * Revue Codex #1012 — Sur Android, couper une catégorie (« Films », « Épisodes et saisons »…) doit
 * aussi faire taire les bannières internes équivalentes : sans cela, un ancien « non » réapparaît
 * dans l'app sans réglage pour le supprimer.
 */
export function keepToastsForOpenChannels(
  candidates: readonly ReminderToastCandidate[],
  blockedChannels: ReadonlySet<string>,
): ReminderToastCandidate[] {
  return candidates.filter(candidate => !candidate.channelId || !blockedChannels.has(candidate.channelId));
}

export interface ReminderToastSummary {
  signature: string;
  message: ToastMessageObj;
  show?: Show;
}

function cleanPresentationText(value: string): string {
  return String(value || '')
    .replace(/\uFFFD/g, '')
    .replace(/^[\s🍿🎉🔔🔕•·\-–—:]+/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildReminderToastSummary(
  candidates: readonly ReminderToastCandidate[],
): ReminderToastSummary | null {
  const unique = Array.from(new Map(
    candidates
      .filter(candidate => Boolean(candidate?.key))
      .map(candidate => [candidate.key, candidate] as const),
  ).values());

  if (unique.length === 0) return null;

  const signature = unique
    .map(candidate => candidate.key)
    .sort((left, right) => left.localeCompare(right))
    .join('|');

  if (unique.length === 1) {
    const candidate = unique[0];
    return {
      signature,
      message: {
        title: cleanPresentationText(candidate.title),
        action: cleanPresentationText(candidate.body),
        posterPath: candidate.posterPath || candidate.show?.posterPath || null,
      },
      show: candidate.show,
    };
  }

  const titles = Array.from(new Set(
    unique
      .map(candidate => cleanPresentationText(candidate.title))
      .filter(Boolean),
  ));
  const preview = titles.slice(0, 3).join(' · ');
  const remaining = Math.max(0, titles.length - 3);

  return {
    signature,
    message: {
      title: `${unique.length} nouveautés aujourd’hui`,
      action: remaining > 0 ? `${preview} · +${remaining}` : preview,
    },
  };
}
