import { useEffect, useState } from 'react';
import { cleanUrl, executeGet } from '../../services/sonarrRadarr';
import { isDownloadFeatureEnabled } from './downloadFeatureVisibility';
import { destinationDisk, formatFreeSpace, LOW_DISK_BYTES } from './arrDiskSpace';

/**
 * Retour du propriétaire du 15/11 : « vu que Sonarr et Radarr ont l'info, peut-on avoir l'espace disque libre en
 * temps réel, à la demande ? » — l'espace libre des dossiers racines de Sonarr et Radarr est relu à chaque
 * ouverture (Réglages → Connexions, onglet Télécharger). Un même disque (même lecteur Windows, ou même dossier) n'est
 * montré qu'une fois. Une lecture en échec n'affiche rien plutôt qu'un chiffre faux. Aucune clé n'est affichée.
 */
/** `services` : Sonarr et/ou Radarr y ont un dossier racine (revue Codex #1063 : rattacher un import à son disque). */
export interface DiskStatus { label: string; freeSpace: number; totalSpace?: number; services?: string[] }
type DiskConfig = { isHydrated?: boolean; downloadsEnabled?: boolean; sonarrUrl?: string; sonarrApiKey?: string; radarrUrl?: string; radarrApiKey?: string };
type Read = (url: string, headers: Record<string, string>) => Promise<unknown>;

const diskLabel = (path: string) => {
  const drive = /^([a-z]):[\\/]/i.exec(path);
  return drive ? `${drive[1].toUpperCase()}:` : path.replace(/\/+$/, '') || '/';
};

export interface DiskSource { host: string; service: string; rootFolders: readonly unknown[]; diskSpace?: readonly unknown[] }
type RawDisk = { path?: string; freeSpace?: number; totalSpace?: number };
const sameOrUnder = (path: string, parent: string) => {
  const norm = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  return norm(path) === norm(parent) || norm(path).startsWith(`${norm(parent)}/`);
};
/**
 * Revue Codex #1058 : deux lecteurs « D: » de machines différentes ne sont jamais fusionnés. Retour du 15/11
 * (v1.4.318, « pas besoin de mettre l'info deux fois ») : Sonarr et Radarr joints par deux adresses différentes
 * voient le même disque ; la taille totale exacte du lecteur (liste `diskspace`) prouve que c'est le même. Sans
 * taille totale, seule la même machine (même hôte) permet de fusionner.
 */
export function mergeDisks(sources: readonly DiskSource[]): DiskStatus[] {
  const disks = new Map<string, DiskStatus & { service: string; host: string; services: string[] }>();
  for (const source of sources) {
    const volumes = (source.diskSpace || []) as RawDisk[];
    for (const root of source.rootFolders as RawDisk[]) {
      if (!root?.path || !Number.isFinite(root.freeSpace)) continue;
      const label = diskLabel(String(root.path));
      const volume = volumes.filter(entry => entry?.path && sameOrUnder(String(root.path), String(entry.path))).sort((a, b) => String(b.path).length - String(a.path).length)[0];
      const totalSpace = Number(root.totalSpace) > 0 ? Number(root.totalSpace) : Number(volume?.totalSpace) > 0 ? Number(volume?.totalSpace) : undefined;
      // Revue Codex #1059 : une capacité égale ne suffit pas ; il faut aussi le même espace libre (à 64 Mo près,
      // deux lectures quasi simultanées du même disque), sinon les disques restent distincts.
      const freeSpace = Number(root.freeSpace);
      const same = [...disks.entries()].find(([, other]) => other.label === label && (other.host === source.host
        || (totalSpace !== undefined && other.totalSpace === totalSpace && Math.abs(other.freeSpace - freeSpace) <= 64 * 1024 ** 2)));
      if (same) { if (!same[1].services.includes(source.service)) same[1].services.push(source.service); }
      else disks.set(`${source.host}\n${label}\n${disks.size}`, { label, host: source.host, service: source.service, services: [source.service], freeSpace, ...(totalSpace ? { totalSpace } : {}) });
    }
  }
  const all = [...disks.values()];
  return all.map(({ service, host: _host, ...disk }) => all.filter(other => other.label === disk.label).length > 1 ? { ...disk, label: `${disk.label} · ${service}` } : disk)
    .sort((a, b) => a.freeSpace - b.freeSpace);
}
const hostOf = (url: string) => { try { return new URL(url).hostname.toLowerCase(); } catch { return url; } };

export async function fetchDiskStatus(config: DiskConfig, read: Read = executeGet): Promise<DiskStatus[]> {
  if (!isDownloadFeatureEnabled(config as Parameters<typeof isDownloadFeatureEnabled>[0])) return [];
  const sources = [['Sonarr', config.sonarrUrl, config.sonarrApiKey], ['Radarr', config.radarrUrl, config.radarrApiKey]].filter(([, url, key]) => url?.trim() && key?.trim()) as Array<[string, string, string]>;
  const list = (value: unknown) => Array.isArray(value) ? value : [];
  const lists = await Promise.all(sources.map(async ([service, url, key]) => {
    const headers = { 'X-Api-Key': key, Accept: 'application/json' };
    const [rootFolders, diskSpace] = await Promise.all([read(`${cleanUrl(url)}/api/v3/rootfolder`, headers).then(list, () => []), read(`${cleanUrl(url)}/api/v3/diskspace`, headers).then(list, () => [])]);
    return { host: hostOf(cleanUrl(url)), service, rootFolders, diskSpace };
  }));
  return mergeDisks(lists);
}

/**
 * Revue Codex #1063 : disque de destination d'un import, seulement s'il est certain — le service (Sonarr pour une
 * série, Radarr pour un film) n'a qu'un seul disque — et presque plein. Sinon rien : l'avertissement global suffit.
 */
export function lowImportDisk(disks: readonly DiskStatus[], mediaType: 'tv' | 'movie'): DiskStatus | undefined {
  const disk = destinationDisk(disks, mediaType);
  return disk && diskTone(disk) !== 'ok' ? disk : undefined;
}

export { destinationDisk, IMPORT_MARGIN_BYTES, spaceShortfall } from './arrDiskSpace';

export type DiskTone = 'ok' | 'warn' | 'error';
export const diskTone = (disk: DiskStatus): DiskTone => disk.freeSpace < 2 * 1024 ** 3 ? 'error' : disk.freeSpace < LOW_DISK_BYTES ? 'warn' : 'ok';
/** « 1,2 Go libres sur 515,7 Go » */
export const describeDisk = (disk: DiskStatus) => `${formatFreeSpace(disk.freeSpace)} libres${disk.totalSpace ? ` sur ${formatFreeSpace(disk.totalSpace)}` : ''}`;

/** Relu à chaque ouverture de l'écran (et quand la configuration change). */
export function useDiskStatus(config: DiskConfig): DiskStatus[] | null {
  const scope = [config.isHydrated, config.downloadsEnabled, config.sonarrUrl, config.sonarrApiKey, config.radarrUrl, config.radarrApiKey].join('\n');
  const [disks, setDisks] = useState<DiskStatus[] | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchDiskStatus(config).then(result => { if (alive) setDisks(result); });
    return () => { alive = false; };
    // La configuration est relue par sa portée : un nouvel objet identique ne relance rien.
  }, [scope]);
  return disks;
}
