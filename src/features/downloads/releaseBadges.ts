/**
 * Retour terrain du 08/11 (recherche avancée, v1.4.271) : le type de release en badges lisibles
 * (« IMAX », « MULTI », « HDR10 », « Atmos »…) plutôt que le nom technique du fichier. Les badges
 * sont lus dans le nom de la release (marqueurs de scène) ; la qualité (1080p, 4K) est déjà affichée
 * à part et le groupe de release n'est jamais repris.
 */
export function releaseBadges(name: string, light = false): string[] {
  const text = ` ${name.replace(/[._]+/g, ' ')} `;
  const has = (pattern: RegExp) => pattern.test(text);
  const badges: string[] = [];
  const add = (label: string | false) => { if (label && !badges.includes(label)) badges.push(label); };

  // Édition et format
  add(has(/\bIMAX\b/i) && 'IMAX');
  add(has(/\bREMUX\b/i) && 'Remux');
  add(has(/\bEXTENDED\b/i) && 'Version longue');
  add(has(/\bREMASTERED\b/i) && 'Remasterisé');
  add(has(/\b3D\b/i) && '3D');
  // Image
  add(has(/\b(?:DV|DOVI|DOLBY ?VISION)\b/i) && 'Dolby Vision');
  add(has(/\bHDR10(?:\+|PLUS)/i) ? 'HDR10+' : has(/\bHDR10\b/i) ? 'HDR10' : has(/\bHDR\b/i) && 'HDR');
  // Langue
  add(has(/\bMULTI\b/i) && 'MULTI');
  add(has(/\b(?:VFF|TRUEFRENCH)\b/i) && 'VFF');
  add(has(/\bVFQ\b/i) && 'VFQ');
  add(has(/\bVOSTFR\b/i) && 'VOSTFR');
  if (!badges.some(badge => badge === 'VFF' || badge === 'VFQ')) add(has(/\b(?:FRENCH|VF|VFI|VF2)\b/i) && 'VF');
  // Son : codec principal, puis canaux (« AC3 5.1 »)
  const channels = text.match(/(?<!\d)([2578]) ([01])(?!\d)/);
  const audio = has(/\bATMOS\b/i) ? 'Atmos' : has(/\bTRUEHD\b/i) ? 'TrueHD' : has(/\bDTS[- ]?HD\b/i) ? 'DTS-HD'
    : has(/\bDTS[- ]?X\b/i) ? 'DTS:X' : has(/\bDTS\b/i) ? 'DTS' : has(/\b(?:DDP|EAC3|E-AC-3)\d*\b|\bDD\+/i) ? 'DD+'
    : has(/\b(?:AC3|DD)\b/i) ? 'AC3' : has(/\bAAC\b/i) ? 'AAC' : '';
  add(audio && channels ? `${audio} ${channels[1]}.${channels[2]}` : audio || (channels ? `${channels[1]}.${channels[2]}` : false));
  // Source
  add(has(/\bWEB[- ]?DL\b/i) ? 'WEB-DL' : has(/\bWEB[- ]?RIP\b/i) ? 'WEBRip' : has(/\bWEB\b/i) ? 'WEB'
    : has(/\b(?:BLU[- ]?RAY|BDRIP|BRRIP|BDREMUX)\b/i) ? 'Blu-ray' : has(/\bHDTV\b/i) ? 'HDTV' : has(/\bDVDRIP\b/i) && 'DVDRip');
  // Vidéo
  add(has(/\b(?:X265|H 265|H265|HEVC)\b/i) ? 'H.265' : has(/\b(?:X264|H 264|H264|AVC)\b/i) ? 'H.264' : has(/\bAV1\b/i) && 'AV1');
  // Plateforme d'origine
  add(has(/\bNF\b/) ? 'Netflix' : has(/\bAMZN\b/) ? 'Prime Video' : has(/\bDSNP\b/) ? 'Disney+' : has(/\bATVP\b/) ? 'Apple TV+' : has(/\bHMAX\b/) && 'Max');
  add(light && 'Light');
  return badges;
}

// Marqueurs techniques non ambigus : ils ne se rencontrent pas comme mots d'un titre et bornent le titre.
const STRONG_MARKER = /^(?:S\d{1,2}(?:E\d{1,3})?|E\d{1,3}|2160p|1080p|1080i|720p|480p|MULTI|TRUEFRENCH|VFF|VFQ|VOSTFR|WEB-DL|WEBRIP|BLURAY|BDRIP|BRRIP|HDTV|DVDRIP|REMUX|HDR10|X264|X265|H264|H265|HEVC|AV1|AMZN|DSNP|ATVP)$/i;
// Marqueurs ambigus (« The French Dispatch », « La French ») : ils ne coupent jamais le titre et ne sont
// retirés qu'en fin de titre, faute d'année pour borner celui-ci.
const WEAK_TRAILING = /^(?:FRENCH|VF|VFI|VF2|VO|IMAX|UHD|4K|HDR|DV|NF|COMPLETE|INTEGRALE|PROPER|REPACK)$/i;
const YEAR = /^(?:19|20)\d{2}$/;
// Épisode avec ou sans saison (« S01E03 », « E01 »), épisodes enchaînés (« S01E01E02 ») ou plage
// (« S01E01-E10 », « S01E01-10 », « E01-E04 », « S01-S05 ») : tout marqueur qui borne le titre et porte la
// portée de la release est gardé dans le libellé lisible.
const EPISODE_RANGE = /^(?:S\d{1,2}(?:E\d{1,3})*|E\d{1,3})(?:-(?:S\d{1,2}(?:E\d{1,3})?|E\d{1,3}|\d{1,3}))?$/i;

export function releaseReadableTitle(name: string): { title: string; year?: string; episode?: string } {
  const tokens = name.replace(/\.(?:mkv|mp4|avi)$/i, '').replace(/[._]+/g, ' ').trim().split(/\s+/);
  const core = (token: string) => token.replace(/-[^-]*$/, '');
  const strong = tokens.findIndex((token, index) => index > 0 && STRONG_MARKER.test(core(token)));
  const head = strong > 0 ? tokens.slice(0, strong) : [...tokens];
  // L'année de sortie est la dernière année avant les marqueurs (« Blade Runner 2049 2017 », « La French 2014
  // FRENCH ») : le titre s'arrête juste avant elle, quels que soient les mots ambigus qui suivent.
  const yearIndex = head.reduce((found, token, index) => (index > 0 && YEAR.test(token) ? index : found), -1);
  let titleTokens = yearIndex > 0 ? head.slice(0, yearIndex) : head;
  if (yearIndex < 0) while (titleTokens.length > 1 && WEAK_TRAILING.test(core(titleTokens[titleTokens.length - 1]))) titleTokens = titleTokens.slice(0, -1);
  // Une plage (« S01E01-E02 », « S01E01-E10 », « S01-S05 ») est gardée entière : seul un suffixe de groupe
  // (« S01E03-NoTag ») est retiré.
  const fullEpisode = (token: string) => EPISODE_RANGE.test(token) ? token : EPISODE_RANGE.test(core(token)) ? core(token) : null;
  const episodeToken = tokens.map(fullEpisode).find((token): token is string => token !== null);
  const title = titleTokens.join(' ').replace(/-+$/, '').trim() || name;
  return { title, year: yearIndex > 0 ? head[yearIndex] : undefined, episode: episodeToken?.toUpperCase() };
}
