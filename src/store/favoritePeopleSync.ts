export interface FavoritePerson {
  id: number;
  name: string;
  profile_path?: string | null;
  known_for_department?: string;
}

export interface FavoritePersonRecord extends FavoritePerson {
  active: boolean;
  updatedAt: number;
  schemaVersion: 1;
}

export function favoritePeopleCollectionPath(uid: string): [string, string, string] {
  if (!uid) throw new Error('UID requis pour synchroniser les personnes favorites');
  return ['users', uid, 'favoritePeople'];
}

export function dedupeFavoritePeople(people: FavoritePerson[]): FavoritePerson[] {
  const byId = new Map<number, FavoritePerson>();
  for (const person of people) {
    if (!person || !Number.isInteger(person.id) || person.id <= 0) continue;
    byId.set(person.id, person);
  }
  return Array.from(byId.values());
}

export function personFromRemoteRecord(id: number, value: unknown): FavoritePerson | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<FavoritePersonRecord>;
  if (record.active === false || !record.name) return null;
  return {
    id,
    name: record.name,
    profile_path: record.profile_path ?? null,
    known_for_department: record.known_for_department,
  };
}

export function selectLocalFavoritesToMigrate(
  localPeople: FavoritePerson[],
  remoteIds: Iterable<number>,
): FavoritePerson[] {
  const remote = new Set(remoteIds);
  return dedupeFavoritePeople(localPeople).filter(person => !remote.has(person.id));
}

export function mergeFavoritePeopleForDisplay(
  localPeople: FavoritePerson[],
  remoteRecords: Iterable<{ id: number; data: unknown }>,
): FavoritePerson[] {
  const records = Array.from(remoteRecords);
  const remoteIds = new Set(records.map(record => record.id));
  const activeRemote = records
    .map(record => personFromRemoteRecord(record.id, record.data))
    .filter((person): person is FavoritePerson => person !== null);
  return dedupeFavoritePeople([
    ...activeRemote,
    ...localPeople.filter(person => !remoteIds.has(person.id)),
  ]);
}
