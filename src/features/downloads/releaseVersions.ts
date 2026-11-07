import { matchesLightFilter } from './releaseQuality.ts';

/** Champs d'une version lus par la page « Version précise » (sous-ensemble de C411Torrent). */
export interface ReleaseLike {
  id: number;
  name: string;
  size: number;
  seeders: number;
  quality?: string;
  language?: string;
  createdAt?: string;
}

export type ReleaseQualityLabel = '4K' | '1080p' | '720p' | 'SD';
export type ReleaseLanguage = 'Français' | 'Multi' | 'VO sous-titrée' | 'VO';
export type VersionFilter = 'Toutes' | '1080p' | '4K' | 'Français' | 'VO';
export const VERSION_FILTERS: readonly VersionFilter[] = ['Toutes', '1080p', '4K', 'Français', 'VO'];

export interface DescribedRelease<T extends ReleaseLike = ReleaseLike> {
  release: T;
  quality: ReleaseQualityLabel;
  language: ReleaseLanguage;
  /** 3 = rapide (≥ 50 sources), 2 = moyen (≥ 10), 1 = lent. */
  speedLevel: 1 | 2 | 3;
  speedLabel: 'Rapide' | 'Moyen' | 'Lent';
  light: boolean;
  /** Jours depuis la mise en ligne, si la date est connue. */
  ageDays?: number;
  recommended: boolean;
}

const token = (name: string, pattern: RegExp) => pattern.test(name.replace(/[._-]+/g, ' '));

export function releaseQualityLabel(release: Pick<ReleaseLike, 'name' | 'quality'>): ReleaseQualityLabel {
  const haystack = `${release.quality || ''} ${release.name}`;
  if (token(haystack, /\b(?:2160p|4k|uhd)\b/i)) return '4K';
  if (token(haystack, /\b1080[pi]\b/i)) return '1080p';
  if (token(haystack, /\b720p\b/i)) return '720p';
  return 'SD';
}

/** Langue lue dans le nom de la release (marqueurs de scène), à défaut dans le champ de l'indexeur. */
export function releaseLanguage(release: Pick<ReleaseLike, 'name' | 'language'>): ReleaseLanguage {
  const name = release.name;
  if (token(name, /\bVOSTFR\b/i)) return 'VO sous-titrée';
  if (token(name, /\bMULTI\b/i)) return 'Multi';
  if (token(name, /\b(?:TRUEFRENCH|FRENCH|VFF|VFQ|VFI|VF2|VOF|VF)\b/i)) return 'Français';
  const declared = (release.language || '').toLowerCase();
  if (/multi/.test(declared)) return 'Multi';
  if (/fran|french|vf/.test(declared)) return 'Français';
  return 'VO';
}

const speedOf = (seeders: number): Pick<DescribedRelease, 'speedLevel' | 'speedLabel'> =>
  seeders >= 50 ? { speedLevel: 3, speedLabel: 'Rapide' } : seeders >= 10 ? { speedLevel: 2, speedLabel: 'Moyen' } : { speedLevel: 1, speedLabel: 'Lent' };

/** Une version s'entend en français si sa piste française est prouvée (Français ou Multi). */
export const hasFrenchAudio = (language: ReleaseLanguage) => language === 'Français' || language === 'Multi';

/**
 * #879 — Décrit et classe les versions : la « Conseillée » est la mieux partagée parmi celles qui
 * ont une piste française, dans la qualité préférée et hors Light ; à défaut, la mieux partagée.
 * Les autres suivent par nombre de sources décroissant. Aucune version n'est masquée ici.
 */
export function describeReleases<T extends ReleaseLike>(releases: readonly T[], preferred: '1080p' | '4k' = '1080p', now = Date.now()): DescribedRelease<T>[] {
  const described = releases.map(release => {
    const created = release.createdAt ? Date.parse(release.createdAt) : NaN;
    return {
      release,
      quality: releaseQualityLabel(release),
      language: releaseLanguage(release),
      ...speedOf(Number(release.seeders) || 0),
      light: !matchesLightFilter(release.name, 'standard'),
      ageDays: Number.isFinite(created) ? Math.max(0, Math.floor((now - created) / 86_400_000)) : undefined,
      recommended: false
    };
  }).sort((a, b) => (Number(b.release.seeders) || 0) - (Number(a.release.seeders) || 0));
  const target = preferred === '4k' ? '4K' : '1080p';
  const best = described.find(entry => entry.quality === target && hasFrenchAudio(entry.language) && !entry.light) ?? described[0];
  if (best) best.recommended = true;
  return best ? [best, ...described.filter(entry => entry !== best)] : described;
}

export function matchesVersionFilter(entry: Pick<DescribedRelease, 'quality' | 'language'>, filter: VersionFilter): boolean {
  if (filter === 'Toutes') return true;
  if (filter === '1080p' || filter === '4K') return entry.quality === filter;
  if (filter === 'Français') return hasFrenchAudio(entry.language);
  return entry.language !== 'Français';
}

/** Taille à la française (« 2,1 Go », « 850 Mo »). */
export function formatReleaseSize(bytes: number): string {
  const size = Number(bytes) || 0;
  if (size >= 1024 ** 3) return `${(size / 1024 ** 3).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Go`;
  return `${Math.max(1, Math.round(size / 1024 ** 2)).toLocaleString('fr-FR')} Mo`;
}

export function releaseAgeLabel(ageDays?: number): string {
  if (ageDays === undefined) return '';
  if (ageDays === 0) return "mis en ligne aujourd'hui";
  if (ageDays === 1) return 'mis en ligne hier';
  if (ageDays < 31) return `mis en ligne il y a ${ageDays} j`;
  const months = Math.floor(ageDays / 30);
  return months < 12 ? `mis en ligne il y a ${months} mois` : `mis en ligne il y a ${Math.floor(ageDays / 365)} an${ageDays >= 730 ? 's' : ''}`;
}
