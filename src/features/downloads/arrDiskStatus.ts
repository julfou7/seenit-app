import { useEffect, useState } from 'react';
import { cleanUrl, executeGet } from '../../services/sonarrRadarr';
import { isDownloadFeatureEnabled } from './downloadFeatureVisibility';
import { formatFreeSpace, LOW_DISK_BYTES } from './arrDiskSpace';

/**
 * Retour du propriétaire du 15/11 : « vu que Sonarr et Radarr ont l'info, peut-on avoir l'espace disque libre en
 * temps réel, à la demande ? » — l'espace libre des dossiers racines de Sonarr et Radarr est relu à chaque
 * ouverture (Réglages → Connexions, onglet Télécharger). Un même disque (même lecteur Windows, ou même dossier) n'est
 * montré qu'une fois. Une lecture en échec n'affiche rien plutôt qu'un chiffre faux. Aucune clé n'est affichée.
 */
export interface DiskStatus { label: string; freeSpace: number; totalSpace?: number }
type DiskConfig = { isHydrated?: boolean; downloadsEnabled?: boolean; sonarrUrl?: string; sonarrApiKey?: string; radarrUrl?: string; radarrApiKey?: string };
type Read = (url: string, headers: Record<string, string>) => Promise<unknown>;

const diskLabel = (path: string) => {
  const drive = /^([a-z]):[\\/]/i.exec(path);
  return drive ? `${drive[1].toUpperCase()}:` : path.replace(/\/+$/, '') || '/';
};

export interface DiskSource { host: string; service: string; rootFolders: readonly unknown[] }
/**
 * Revue Codex #1058 : deux disques ne sont fusionnés que s'ils sont sur la même machine (même hôte) ; deux lecteurs
 * « D: » de machines différentes restent distincts et sont nommés avec leur service (« D: · Radarr »).
 */
export function mergeDisks(sources: readonly DiskSource[]): DiskStatus[] {
  const disks = new Map<string, DiskStatus & { service: string }>();
  for (const source of sources) {
    for (const root of source.rootFolders as Array<{ path?: string; freeSpace?: number; totalSpace?: number }>) {
      if (!root?.path || !Number.isFinite(root.freeSpace)) continue;
      const label = diskLabel(String(root.path));
      const key = `${source.host}\n${label}`;
      if (!disks.has(key)) disks.set(key, { label, service: source.service, freeSpace: Number(root.freeSpace), ...(Number(root.totalSpace) > 0 ? { totalSpace: Number(root.totalSpace) } : {}) });
    }
  }
  const all = [...disks.values()];
  return all.map(({ service, ...disk }) => all.filter(other => other.label === disk.label).length > 1 ? { ...disk, label: `${disk.label} · ${service}` } : disk)
    .sort((a, b) => a.freeSpace - b.freeSpace);
}
const hostOf = (url: string) => { try { return new URL(url).hostname.toLowerCase(); } catch { return url; } };

export async function fetchDiskStatus(config: DiskConfig, read: Read = executeGet): Promise<DiskStatus[]> {
  if (!isDownloadFeatureEnabled(config as Parameters<typeof isDownloadFeatureEnabled>[0])) return [];
  const sources = [['Sonarr', config.sonarrUrl, config.sonarrApiKey], ['Radarr', config.radarrUrl, config.radarrApiKey]].filter(([, url, key]) => url?.trim() && key?.trim()) as Array<[string, string, string]>;
  const lists = await Promise.all(sources.map(([service, url, key]) => read(`${cleanUrl(url)}/api/v3/rootfolder`, { 'X-Api-Key': key, Accept: 'application/json' })
    .then(list => ({ host: hostOf(cleanUrl(url)), service, rootFolders: Array.isArray(list) ? list : [] }), () => ({ host: hostOf(cleanUrl(url)), service, rootFolders: [] }))));
  return mergeDisks(lists);
}

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
