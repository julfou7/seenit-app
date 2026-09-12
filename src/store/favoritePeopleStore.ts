import { create } from 'zustand';
import { collection, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { purgeLegacyUnscopedUserData, readUserScopedJson, writeUserScopedJson } from '../lib/userIsolation';
import {
  dedupeFavoritePeople,
  favoritePeopleCollectionPath,
  mergeFavoritePeopleForDisplay,
  selectLocalFavoritesToMigrate,
  type FavoritePerson as Person,
} from './favoritePeopleSync';

export type { FavoritePerson as Person } from './favoritePeopleSync';

interface FavoritePeopleState {
  people: Person[];
  addPerson: (person: Person) => void;
  removePerson: (id: number) => void;
  isFavorite: (id: number) => boolean;
}

const FAVORITE_PEOPLE_FIELD = 'favorite_people';
let unsubscribeFavoritePeople: (() => void) | null = null;

function loadLocal(uid: string): Person[] {
  const value = readUserScopedJson<Person[]>(uid, FAVORITE_PEOPLE_FIELD, []);
  return Array.isArray(value) ? dedupeFavoritePeople(value) : [];
}

function persistLocal(uid: string, people: Person[]) {
  writeUserScopedJson(uid, FAVORITE_PEOPLE_FIELD, dedupeFavoritePeople(people));
}

function favoritePeopleCollection(uid: string) {
  const [root, userId, child] = favoritePeopleCollectionPath(uid);
  return collection(db, root, userId, child);
}

function persistFavoritePerson(uid: string, person: Person, active: boolean) {
  const ref = doc(favoritePeopleCollection(uid), String(person.id));
  return setDoc(ref, {
    ...person,
    active,
    updatedAt: Date.now(),
    schemaVersion: 1,
  }, { merge: true });
}

export const useFavoritePeopleStore = create<FavoritePeopleState>((set, get) => ({
  people: [],
  addPerson: (person) => {
    const user = auth.currentUser;
    if (!user || !Number.isInteger(person.id) || person.id <= 0) return;
    if (get().people.some(candidate => candidate.id === person.id)) return;

    const people = dedupeFavoritePeople([...get().people, person]);
    persistLocal(user.uid, people);
    set({ people });
    void persistFavoritePerson(user.uid, person, true).catch(error => {
      console.warn('Favorite person cloud write failed; Firestore will retry when possible.', error);
    });
  },
  removePerson: (id) => {
    const user = auth.currentUser;
    if (!user) return;
    const existing = get().people.find(person => person.id === id);
    if (!existing) return;

    const people = get().people.filter(person => person.id !== id);
    persistLocal(user.uid, people);
    set({ people });
    void persistFavoritePerson(user.uid, existing, false).catch(error => {
      console.warn('Favorite person tombstone write failed; Firestore will retry when possible.', error);
    });
  },
  isFavorite: (id) => get().people.some(person => person.id === id),
}));

function activateFavoritePeopleScope(uid?: string | null) {
  if (unsubscribeFavoritePeople) {
    unsubscribeFavoritePeople();
    unsubscribeFavoritePeople = null;
  }

  purgeLegacyUnscopedUserData(uid);
  const localSeed = uid ? loadLocal(uid) : [];
  useFavoritePeopleStore.setState({ people: localSeed });
  if (!uid) return;

  const favoritesRef = favoritePeopleCollection(uid);
  let authoritativeMigrationStarted = false;

  unsubscribeFavoritePeople = onSnapshot(
    favoritesRef,
    { includeMetadataChanges: true },
    snapshot => {
      if (auth.currentUser?.uid !== uid) return;

      const remoteRecords = snapshot.docs
        .map(remoteDoc => ({ id: Number(remoteDoc.id), data: remoteDoc.data() }))
        .filter(record => Number.isInteger(record.id) && record.id > 0);
      const visiblePeople = mergeFavoritePeopleForDisplay(localSeed, remoteRecords);
      persistLocal(uid, visiblePeople);
      useFavoritePeopleStore.setState({ people: visiblePeople });

      // Never migrate from a cache-only snapshot: an unseen cloud tombstone must
      // win over stale local data. Once the server snapshot is authoritative,
      // only missing TMDB IDs are imported; existing cloud records are untouched.
      if (!snapshot.metadata.fromCache && !authoritativeMigrationStarted) {
        authoritativeMigrationStarted = true;
        const remoteIds = remoteRecords.map(record => record.id);
        const missingLocalPeople = selectLocalFavoritesToMigrate(localSeed, remoteIds);
        void Promise.all(missingLocalPeople.map(person => persistFavoritePerson(uid, person, true)))
          .catch(error => {
            console.warn('Favorite people migration failed.', error);
          });
      }
    },
    error => {
      if (auth.currentUser?.uid !== uid) return;
      console.warn('Favorite people realtime sync unavailable; using local cache.', error);
    },
  );
}

auth.onAuthStateChanged(user => activateFavoritePeopleScope(user?.uid));
