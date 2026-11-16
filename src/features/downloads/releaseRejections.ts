import { frenchArrMessage } from './arrStatusMessages.ts';

/**
 * Retour terrain du 16/11 (« Chercher une autre release », Heart of the Beast) : les raisons de refus de Sonarr/Radarr
 * s'affichaient en anglais et la même phrase était répétée sur chaque version. Chaque raison connue est traduite ;
 * une raison commune à toutes les versions refusées est dite une seule fois, en tête de liste.
 */
const fr = (value: string) => value.replace(/\bGB\b/g, 'Go').replace(/\bMB\b/g, 'Mo').replace(/(\d)\.(\d)/g, '$1,$2');
const KNOWN: ReadonlyArray<readonly [RegExp, (match: RegExpExecArray) => string]> = [
  [/^(.+?) is not wanted in profile/i, match => `Qualité ${match[1].trim()} hors du profil choisi`],
  [/release in queue already meets cutoff/i, () => 'Une version de qualité suffisante est déjà en cours de téléchargement'],
  [/existing file.*meets cutoff|existing file on disk is of equal or higher/i, () => 'Une version de qualité suffisante est déjà présente'],
  [/([\d.,]+ ?[GM]B) is smaller than minimum allowed ([\d.,]+ ?[GM]B)(?: \(for (\d+) ?min\))?/i, match => fr(`Trop petite pour le profil : ${match[1]}, minimum ${match[2]}${match[3] ? ` pour ${match[3]} min` : ''}`)],
  [/([\d.,]+ ?[GM]B) is larger than maximum allowed ([\d.,]+ ?[GM]B)/i, match => fr(`Trop grosse pour le profil : ${match[1]}, maximum ${match[2]}`)],
  [/language is not wanted|wanted language/i, () => 'Langue non voulue par le profil'],
  [/blocklist/i, () => 'Version écartée (liste noire)'],
  [/custom format score/i, () => 'Score de formats personnalisés insuffisant'],
  [/(?:minimum age|delay|not available until)/i, () => 'Pas encore autorisée (délai du profil)'],
  [/already in (?:the )?queue|release in queue/i, () => 'Déjà dans la file de téléchargement'],
  [/not an upgrade/i, () => 'Pas une amélioration de la version présente'],
  [/full season pack/i, () => 'Pack de saison complet non voulu'],
];

export function frenchRejection(reason: string): string {
  const text = String(reason || '').trim();
  for (const [pattern, render] of KNOWN) { const match = pattern.exec(text); if (match) return render(match); }
  return frenchArrMessage(text);
}

/** Raisons traduites d'une version, sans doublon. */
export const frenchRejections = (reasons: readonly string[]) => [...new Set(reasons.map(frenchRejection).filter(Boolean))];

/** Raisons partagées par toutes les versions refusées (au moins deux) : dites une fois en tête. */
export function commonRejections(lists: ReadonlyArray<readonly string[]>): string[] {
  const refused = lists.filter(list => list.length > 0);
  if (refused.length < 2) return [];
  return refused[0].filter(reason => refused.every(list => list.includes(reason)));
}

/** Qualité refusée par le profil (« WEBDL-2160p is not wanted in profile ») : proposer de passer le titre en 4K ou 1080p. */
export function profileSwitchFor(reasons: readonly string[]): '4k' | '1080p' | null {
  const blocked = reasons.find(reason => /is not wanted in profile/i.test(reason));
  if (!blocked) return null;
  if (/2160|4k|uhd/i.test(blocked)) return '4k';
  if (/1080/.test(blocked)) return '1080p';
  return null;
}
