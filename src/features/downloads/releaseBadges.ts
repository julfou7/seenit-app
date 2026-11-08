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
