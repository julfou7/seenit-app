import { create } from 'zustand';
import { auth } from '../lib/firebase';
import { purgeLegacyUnscopedUserData, readUserScopedJson, writeUserScopedJson } from '../lib/userIsolation';

export interface Person {
  id: number;
  name: string;
  profile_path?: string | null;
  known_for_department?: string;
}

interface FavoritePeopleState {
  people: Person[];
  addPerson: (person: Person) => void;
  removePerson: (id: number) => void;
  isFavorite: (id: number) => boolean;
}

const FAVORITE_PEOPLE_FIELD = 'favorite_people';

export const useFavoritePeopleStore = create<FavoritePeopleState>((set, get) => ({
  people: [],
  addPerson: (person) => set((state) => {
    if (state.people.some(p => p.id === person.id)) return state;
    const people = [...state.people, person];
    writeUserScopedJson(auth.currentUser?.uid, FAVORITE_PEOPLE_FIELD, people);
    return { people };
  }),
  removePerson: (id) => set((state) => {
    const people = state.people.filter(p => p.id !== id);
    writeUserScopedJson(auth.currentUser?.uid, FAVORITE_PEOPLE_FIELD, people);
    return { people };
  }),
  isFavorite: (id) => get().people.some(p => p.id === id)
}));

auth.onAuthStateChanged((user) => {
  purgeLegacyUnscopedUserData(user?.uid);
  useFavoritePeopleStore.setState({
    people: readUserScopedJson<Person[]>(user?.uid, FAVORITE_PEOPLE_FIELD, [])
  });
});
