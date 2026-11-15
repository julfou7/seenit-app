/**
 * Retour terrain du 15/11 (Dexter : Résurrection S02E01–E02) : Programmés disait « Recherché · pas encore de version »
 * alors que Sonarr refusait toutes les versions faute de place sur le disque. Un recherché bloqué par le disque est
 * prouvé avec les règles mêmes de Sonarr/Radarr (contrôle d'espace libre de leur moteur de décision) :
 * - la plus petite version acceptée par le profil fait au moins `minSize` (Mo/min) × durée, pour la meilleure
 *   qualité autorisée la moins exigeante ;
 * - une version est refusée si l'espace libre du dossier racine, moins sa taille, passe sous la marge minimale
 *   (`minimumFreeSpaceWhenImporting`, Mo), sauf si ce contrôle est désactivé.
 * Si même la plus petite version possible est refusée, toutes le sont : le disque bloque, ce n'est pas une absence
 * de version. Toute donnée manquante (dossier, durée, profil, réglage) ne prouve rien.
 */
export interface DiskRules { roots: Array<{ path: string; freeSpace: number }>; minFreeMb: number; skip: boolean; minMbPerMinute: Map<number, number>; profileQualities: Map<number, number[]> }

type RawProfileItem = { allowed?: boolean; quality?: { id?: number }; items?: RawProfileItem[] };
const MB = 1024 * 1024;

const allowedQualities = (items: RawProfileItem[] = []): number[] => items.flatMap(item => item.items?.length
  ? item.allowed ? allowedQualities(item.items.map(child => ({ ...child, allowed: true }))) : allowedQualities(item.items)
  : item.allowed && Number(item.quality?.id) >= 0 ? [Number(item.quality!.id)] : []);

/** Règles lues dans Sonarr ou Radarr ; `null` si une lecture manque (jamais de preuve partielle). */
export function parseDiskRules(rootFolders: unknown, mediaManagement: unknown, definitions: unknown, profiles: unknown): DiskRules | null {
  if (!Array.isArray(rootFolders) || !Array.isArray(definitions) || !Array.isArray(profiles) || !mediaManagement || typeof mediaManagement !== 'object') return null;
  const config = mediaManagement as { minimumFreeSpaceWhenImporting?: number; skipFreeSpaceCheckWhenImporting?: boolean };
  return {
    roots: (rootFolders as Array<{ path?: string; freeSpace?: number }>).filter(root => root.path && Number.isFinite(root.freeSpace)).map(root => ({ path: String(root.path), freeSpace: Number(root.freeSpace) })),
    minFreeMb: Number(config.minimumFreeSpaceWhenImporting) || 0,
    skip: config.skipFreeSpaceCheckWhenImporting === true,
    minMbPerMinute: new Map((definitions as Array<{ quality?: { id?: number }; minSize?: number }>).filter(entry => Number(entry.quality?.id) >= 0).map(entry => [Number(entry.quality!.id), Number(entry.minSize) || 0])),
    profileQualities: new Map((profiles as Array<{ id?: number; items?: RawProfileItem[] }>).filter(profile => Number(profile.id) > 0).map(profile => [Number(profile.id), allowedQualities(profile.items)])),
  };
}

/** Revue Codex #1049 : la casse compte sur un serveur Linux ; seuls les chemins Windows (lecteur ou `\`) l'ignorent. */
const normalize = (path: string) => {
  const windows = /^[a-z]:[\\/]|\\/i.test(path);
  const slashed = path.replace(/\\/g, '/').replace(/\/+$/, '');
  return windows ? slashed.toLowerCase() : slashed;
};

/** Vrai seulement si chaque version acceptable serait refusée faute de place. */
export function proveDiskFull(rules: DiskRules | null, target: { path?: string; runtime?: number; profileId?: number; special?: boolean }): boolean {
  // Revue Codex #1049 : Sonarr n'applique pas de taille minimale aux spéciaux (saison 0) ; rien n'y est prouvable.
  if (!rules || rules.skip || target.special || !target.path || !target.profileId) return false;
  const path = normalize(target.path);
  const root = rules.roots.filter(entry => path === normalize(entry.path) || path.startsWith(`${normalize(entry.path)}/`)).sort((a, b) => b.path.length - a.path.length)[0];
  const qualities = rules.profileQualities.get(target.profileId);
  if (!root || !qualities?.length) return false;
  const runtime = Number(target.runtime) > 0 ? Number(target.runtime) : 0;
  const smallestMb = Math.min(...qualities.map(id => (rules.minMbPerMinute.get(id) ?? 0) * runtime));
  return root.freeSpace - smallestMb * MB < rules.minFreeMb * MB;
}
