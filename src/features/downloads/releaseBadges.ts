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

const MARKER = /^(?:S\d{1,2}(?:E\d{1,3})?|E\d{1,3}|2160p|1080p|1080i|720p|480p|4K|UHD|MULTI|TRUEFRENCH|FRENCH|VFF|VFQ|VFI|VF2|VF|VOSTFR|VO|WEB|WEB-DL|WEBRIP|BLURAY|BDRIP|BRRIP|HDTV|DVDRIP|REMUX|IMAX|REPACK|PROPER|COMPLETE|INTEGRALE|HDR|HDR10|DV|X264|X265|H264|H265|HEVC|AV1|NF|AMZN|DSNP|ATVP)$/i;
const YEAR = /^(?:19|20)\d{2}$/;

/**
 * Retour terrain du 08/11 : « comment savoir que c'est le bon torrent si on n'affiche pas le nom ? ».
 * Titre lisible tiré du nom de la release — mots avant les marqueurs techniques, année et épisode à part
 * (« Spider Man Brand New Day · 2026 », « L Arene · S01E03 ») ; le nom technique reste dépliable.
 */
export function releaseReadableTitle(name: string): { title: string; year?: string; episode?: string } {
  const tokens = name.replace(/\.(?:mkv|mp4|avi)$/i, '').replace(/[._]+/g, ' ').trim().split(/\s+/);
  const cut = tokens.findIndex((token, index) => index > 0 && MARKER.test(token.replace(/-[^-]*$/, '')));
  const head = cut > 0 ? tokens.slice(0, cut) : tokens;
  // Le dernier nombre-année avant les marqueurs est l'année de sortie (« Blade Runner 2049 2017 »).
  const year = head.length > 1 && YEAR.test(head[head.length - 1]) ? head.pop() : undefined;
  const episodeToken = tokens.slice(Math.max(cut, 0)).find(token => /^S\d{1,2}(?:E\d{1,3})?$/i.test(token));
  const title = head.join(' ').replace(/-+$/, '').trim() || name;
  return { title, year, episode: episodeToken?.toUpperCase() };
}
