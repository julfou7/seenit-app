export interface TrailerVideo {
  site: string;
  key: string;
  name: string;
  iso_639_1?: string;
  iso_3166_1?: string;
  type?: string;
  official?: boolean;
  published_at?: string;
}

type LanguageEvidence = Pick<TrailerVideo, 'name' | 'iso_639_1'>;
export interface PreparedTrailerVideo extends TrailerVideo {
  languageLabel: string;
  typeLabel: string;
}

/** TMDB fournit une langue de vidéo, pas une preuve de doublage ou de piste CC. */
export function classifyTrailerLanguage(video: LanguageEvidence): string {
  const name = (video.name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const vf = /\bvf\b|\bversion francaise\b|\bfrench dubbed\b/.test(name);
  const vostfr = /\bvostfr\b|\bversion originale sous[ -]titree (?:en )?francais(?:e)?\b/.test(name);
  const vo = /\bvo\b|\bversion originale\b|\boriginal version\b/.test(name);
  if (vf && !vostfr && !vo) return 'VF';
  if (vostfr && !vf) return 'VOSTFR';
  if (vo && !vf && !vostfr) return 'VO';
  const language = video.iso_639_1?.toLowerCase();
  if (language && /^[a-z]{2}$/.test(language)) {
    try {
      const label = new Intl.DisplayNames(['fr'], { type: 'language', fallback: 'none' }).of(language);
      if (label) return label.charAt(0).toUpperCase() + label.slice(1);
    } catch { /* Code inconnu : ne pas inventer une langue. */ }
  }
  return 'Langue non précisée';
}

const TYPES: Record<string, string> = {
  Trailer: 'Bande-annonce', Teaser: 'Teaser', Clip: 'Extrait',
  Featurette: 'Coulisses', 'Behind the Scenes': 'Coulisses', Bloopers: 'Bêtisier',
};
const rank = (video: TrailerVideo) => (video.type === 'Trailer' ? 0 : video.type === 'Teaser' ? 2 : 4) + (video.official === true ? 0 : 1);
const proven = (video: TrailerVideo) => ['VF', 'VOSTFR', 'VO'].includes(classifyTrailerLanguage(video));

export function prepareTrailerVideos(videos: TrailerVideo[]): PreparedTrailerVideo[] {
  const candidates = videos.filter(video => video.site === 'YouTube' && /^[\w-]+$/.test(video.key || ''))
    .map((video, index) => ({ video, index }))
    .sort((left, right) => rank(left.video) - rank(right.video) || Number(proven(right.video)) - Number(proven(left.video)) || left.index - right.index);
  const unique = new Map<string, PreparedTrailerVideo>();
  for (const { video } of candidates) {
    if (unique.has(video.key)) continue;
    const duplicates = candidates.filter(candidate => candidate.video.key === video.key).map(candidate => candidate.video);
    const labels = new Set(duplicates.filter(proven).map(classifyTrailerLanguage));
    const languageLabel = labels.size > 1
      ? classifyTrailerLanguage({ name: '', iso_639_1: video.iso_639_1 })
      : labels.size === 1 ? [...labels][0] : classifyTrailerLanguage(video);
    unique.set(video.key, {
      ...video,
      name: video.name?.trim() || `Bande-annonce ${unique.size + 1}`,
      typeLabel: TYPES[video.type || ''] || video.type || 'Vidéo',
      languageLabel,
    });
  }
  return [...unique.values()];
}

export function trailerEmbedUrl(video: Pick<TrailerVideo, 'key' | 'name' | 'iso_639_1'> & { languageLabel?: string }): string {
  const params = new URLSearchParams({ autoplay: '1', rel: '0', playsinline: '1', controls: '1', fs: '1' });
  if ((video.languageLabel || classifyTrailerLanguage(video)) === 'VOSTFR') {
    params.set('cc_lang_pref', 'fr');
    params.set('cc_load_policy', '1');
  }
  return `https://www.youtube.com/embed/${encodeURIComponent(video.key)}?${params}`;
}
