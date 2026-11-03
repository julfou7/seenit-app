/**
 * SEENIT-UX-019 — L'app est en français : TMDB laisse certains genres (surtout télé) et rôles en anglais,
 * même en `fr-FR` (« Reality », « Sci-Fi & Fantasy », « Self », « Himself »…). Les genres sont traduits par
 * identifiant TMDB, les rôles génériques par une table fermée ; un rôle inconnu reste tel que fourni.
 */
const GENRE_FR: Record<number, string> = {
  28: 'Action', 12: 'Aventure', 16: 'Animation', 35: 'Comédie', 80: 'Crime', 99: 'Documentaire', 18: 'Drame',
  10751: 'Familial', 14: 'Fantastique', 36: 'Histoire', 27: 'Horreur', 10402: 'Musique', 9648: 'Mystère',
  10749: 'Romance', 878: 'Science-fiction', 10770: 'Téléfilm', 53: 'Thriller', 10752: 'Guerre', 37: 'Western',
  10759: 'Action & aventure', 10762: 'Enfants', 10763: 'Actualités', 10764: 'Téléréalité',
  10765: 'Science-fiction & fantastique', 10766: 'Feuilleton', 10767: 'Talk-show', 10768: 'Guerre & politique',
};

export function frenchGenreName(genre: { id?: number | null; name?: string | null }): string {
  const known = genre.id ? GENRE_FR[Number(genre.id)] : undefined;
  return known || String(genre.name || '').trim();
}

export function frenchGenres<T extends { id?: number | null; name?: string | null }>(genres: readonly T[] | null | undefined): Array<T & { name: string }> {
  return (genres || []).map(genre => ({ ...genre, name: frenchGenreName(genre) })).filter(genre => genre.name);
}

type Gendered = [masculine: string, feminine: string];
const ROLE_FR: Record<string, Gendered> = {
  self: ['Lui-même', 'Elle-même'], himself: ['Lui-même', 'Lui-même'], herself: ['Elle-même', 'Elle-même'],
  host: ['Présentateur', 'Présentatrice'], 'co-host': ['Coprésentateur', 'Coprésentatrice'], presenter: ['Présentateur', 'Présentatrice'],
  narrator: ['Narrateur', 'Narratrice'], contestant: ['Candidat', 'Candidate'], judge: ['Juré', 'Jurée'], guest: ['Invité', 'Invitée'],
  'guest star': ['Invité vedette', 'Invitée vedette'], 'various characters': ['Plusieurs personnages', 'Plusieurs personnages'],
  various: ['Divers', 'Divers'], voice: ['Voix', 'Voix'], 'additional voices': ['Voix additionnelles', 'Voix additionnelles'],
  commentator: ['Commentateur', 'Commentatrice'], interviewee: ['Intervenant', 'Intervenante'],
};

/** Traduit un rôle générique ; `gender` TMDB : 1 = femme, 2 = homme. Les suffixes « (voice) » et « (uncredited) » sont traduits. */
export function frenchCharacterName(role: string | null | undefined, gender?: number | null): string {
  const raw = String(role || '').trim();
  if (!raw) return '';
  let suffix = '';
  let base = raw;
  for (const [pattern, label] of [[/\s*\((?:voice|voix)\)\s*/i, ' · voix'], [/\s*\(uncredited\)\s*/i, ' (non crédité)'], [/\s*\(archive footage\)\s*/i, ' (images d’archives)']] as const) {
    if (pattern.test(base)) { base = base.replace(pattern, ' ').trim(); suffix += label; }
  }
  const parts = base.split(/\s*\/\s*/).map(part => {
    const entry = ROLE_FR[part.toLowerCase().replace(/\s*-\s*(?:self|host)$/i, match => match.trim())];
    if (!entry) {
      const selfWithShow = /^(?:self|himself|herself)\s*-\s*(.+)$/i.exec(part);
      if (selfWithShow) return `${gender === 1 ? 'Elle-même' : 'Lui-même'} · ${selfWithShow[1]}`;
      return part;
    }
    return gender === 1 ? entry[1] : entry[0];
  });
  return `${parts.join(' / ')}${suffix}`.trim();
}
