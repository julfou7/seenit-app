export type DownloadQualityPreference = '1080p' | '4k';

export interface QualityProfileSummary {
  id: number;
  name: string;
}

function normalizeProfileName(name: string): string {
  return (name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function score1080pProfile(profile: QualityProfileSummary): number {
  const name = normalizeProfileName(profile.name);
  const compact = name.replace(/\s+/g, '');

  if (/2160|4k|uhd|ultrahd/.test(compact)) return -1000;

  let score = 0;
  if (compact === 'hd1080p' || compact === '1080p' || compact === 'fullhd' || compact === 'fhd') score += 120;
  if (compact.includes('1080')) score += 80;
  if (compact.includes('hd')) score += 12;
  if (compact.includes('720')) score -= 45;
  if (compact.includes('any')) score -= 35;
  return score;
}

function score4kProfile(profile: QualityProfileSummary): number {
  const name = normalizeProfileName(profile.name);
  const compact = name.replace(/\s+/g, '');

  let score = 0;
  if (compact === 'ultrahd' || compact === 'uhd' || compact === '4k' || compact === '2160p') score += 130;
  if (/2160|4k|uhd|ultrahd/.test(compact)) score += 90;
  if (compact.includes('1080')) score -= 20;
  if (compact.includes('any')) score += 5;
  return score;
}

/**
 * Détermine le profil que SeenIt doit utiliser en mode Auto sans dépendre de
 * l'ordre renvoyé par Sonarr/Radarr. Pour le 1080p, un profil 1080p dédié est
 * volontairement prioritaire sur un profil mixte 720p/1080p.
 */
export function resolveAutoQualityProfile(
  profiles: QualityProfileSummary[],
  preference: DownloadQualityPreference
): QualityProfileSummary | null {
  if (!profiles.length) return null;

  const scored = profiles
    .map(profile => ({
      profile,
      score: preference === '4k' ? score4kProfile(profile) : score1080pProfile(profile)
    }))
    .sort((a, b) => b.score - a.score || a.profile.id - b.profile.id);

  if (scored[0]?.score > 0) return scored[0].profile;

  if (preference === '4k') {
    return profiles.find(profile => normalizeProfileName(profile.name) === 'any')
      || profiles[profiles.length - 1]
      || null;
  }

  const hdFallback = profiles.find(profile => {
    const compact = normalizeProfileName(profile.name).replace(/\s+/g, '');
    return compact.includes('hd') && !/2160|4k|uhd|ultrahd/.test(compact);
  });
  return hdFallback || profiles[0] || null;
}

export function resolveEffectiveQualityProfileId(
  profiles: QualityProfileSummary[],
  preference: DownloadQualityPreference,
  explicitProfileId?: number | null
): number | undefined {
  if (explicitProfileId && explicitProfileId > 0) return explicitProfileId;
  return resolveAutoQualityProfile(profiles, preference)?.id;
}
