import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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

export const useFavoritePeopleStore = create<FavoritePeopleState>()(
  persist(
    (set, get) => ({
      people: [],
      addPerson: (person) => set((state) => {
        if (state.people.some(p => p.id === person.id)) return state;
        return { people: [...state.people, person] };
      }),
      removePerson: (id) => set((state) => ({
        people: state.people.filter(p => p.id !== id)
      })),
      isFavorite: (id) => get().people.some(p => p.id === id)
    }),
    {
      name: 'favorite-people-storage'
    }
  )
);
