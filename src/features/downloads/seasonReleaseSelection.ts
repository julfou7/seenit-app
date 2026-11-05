import type { ArrRelease } from './downloadNoRelease.ts';

/** Un pack confirmé ou une release par épisode mappé, depuis la même réponse interactive. */
export function selectArrSeasonReleases(releases: ArrRelease[]): ArrRelease[] {
  const pack = releases.find(release => release.fullSeason === true);
  if (pack) return [pack];
  const covered = new Set<number>();
  return releases.filter(release => {
    const values = release.mappedEpisodeNumbers ?? release.episodeNumbers;
    if (!Array.isArray(values) || !values.length) throw new Error('Le service ne précise pas les épisodes couverts par la release.');
    const episodes = values.map(Number);
    if (episodes.some(number => !Number.isInteger(number) || number < 1)) throw new Error('Épisodes de release invalides.');
    if (episodes.every(number => covered.has(number))) return false;
    // Deux packs partiels qui se chevauchent ne sont pas envoyés aveuglément ensemble.
    if (episodes.some(number => covered.has(number))) return false;
    episodes.forEach(number => covered.add(number));
    return true;
  });
}
