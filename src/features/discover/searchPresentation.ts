import type { Show } from '../../types';

export function foldSearch(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('fr');
}

/** Map folded characters back to original graphemes, including decomposed accents. */
export function searchHighlight(title: string, query: string): [string, string, string] {
  const needle = foldSearch(query.trim());
  if (!needle) return [title, '', ''];
  const offsets: number[] = [];
  let folded = '';
  let offset = 0;
  for (const character of title) {
    const part = foldSearch(character);
    for (const ignored of part) { void ignored; offsets.push(offset); }
    folded += part;
    offset += character.length;
  }
  const start = folded.indexOf(needle);
  if (start < 0) return [title, '', ''];
  const from = offsets[start];
  let to = offsets[start + needle.length] ?? title.length;
  while (to < title.length && /\p{M}/u.test(title[to])) to += 1;
  return [title.slice(0, from), title.slice(from, to), title.slice(to)];
}

export function searchMediaKey(id: number | string, type?: string): string {
  return `${type === 'movie' ? 'movie' : type === 'person' ? 'person' : 'tv'}:${id}`;
}

export function searchLibrary(shows: readonly Show[], query: string): Show[] {
  const needle = foldSearch(query.trim());
  return needle ? shows.filter(show => foldSearch(show.title).includes(needle)) : [];
}

export function librarySearchStatus(show: Show): string {
  if (show.mediaType === 'movie') return show.status === 'completed' || show.seenEpisodes.includes('movie') ? 'Vu' : 'À voir';
  if (show.status === 'completed' || (show.totalAiredEpisodes && show.seenEpisodes.length >= show.totalAiredEpisodes)) return 'À jour';
  return show.seenEpisodes.length ? 'En cours' : 'À commencer';
}
