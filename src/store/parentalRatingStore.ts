import { create } from 'zustand';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { readUserScopedJson, writeUserScopedJson } from '../lib/userIsolation';
import {
  type ParentalMediaType,
  type ParentalRatingOverride,
  parentalRatingKey,
} from '../features/shows/parentalRating';

export type ParentalRatingOverrides = Record<string, ParentalRatingOverride>;

interface ParentalRatingState {
  overrides: ParentalRatingOverrides;
  initialized: boolean;
  setOverride: (mediaType: ParentalMediaType, tmdbId: number, age: number) => Promise<void>;
  clearOverride: (mediaType: ParentalMediaType, tmdbId: number) => Promise<void>;
}

const STORAGE_KEY = 'parental_rating_overrides_v1';
let unsubscribePreferences: (() => void) | null = null;

function loadLocal(uid: string): ParentalRatingOverrides {
  const value = readUserScopedJson<ParentalRatingOverrides>(uid, STORAGE_KEY, {});
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function persistLocal(uid: string, overrides: ParentalRatingOverrides) {
  writeUserScopedJson(uid, STORAGE_KEY, overrides);
}

async function persistCloud(uid: string, overrides: ParentalRatingOverrides) {
  const preferencesRef = doc(db, 'users', uid, 'settings', 'preferences');
  await setDoc(preferencesRef, { parentalRatingOverrides: overrides }, { merge: true });
}

export const useParentalRatingStore = create<ParentalRatingState>((set, get) => ({
  overrides: {},
  initialized: false,

  setOverride: async (mediaType, tmdbId, age) => {
    const user = auth.currentUser;
    if (!user) throw new Error('Not authenticated');
    if (!Number.isInteger(age) || age < 0 || age > 18) throw new Error('Invalid parental age');

    const key = parentalRatingKey(mediaType, tmdbId);
    const next = {
      ...get().overrides,
      [key]: { age, updatedAt: Date.now() },
    };
    persistLocal(user.uid, next);
    set({ overrides: next, initialized: true });
    await persistCloud(user.uid, next);
  },

  clearOverride: async (mediaType, tmdbId) => {
    const user = auth.currentUser;
    if (!user) throw new Error('Not authenticated');

    const key = parentalRatingKey(mediaType, tmdbId);
    const next = { ...get().overrides };
    delete next[key];
    persistLocal(user.uid, next);
    set({ overrides: next, initialized: true });
    await persistCloud(user.uid, next);
  },
}));

function activateParentalRatingScope(uid?: string | null) {
  if (unsubscribePreferences) {
    unsubscribePreferences();
    unsubscribePreferences = null;
  }

  useParentalRatingStore.setState({
    overrides: uid ? loadLocal(uid) : {},
    initialized: !uid,
  });

  if (!uid) return;

  const preferencesRef = doc(db, 'users', uid, 'settings', 'preferences');
  unsubscribePreferences = onSnapshot(preferencesRef, snapshot => {
    if (auth.currentUser?.uid !== uid) return;
    const remote = snapshot.data()?.parentalRatingOverrides;
    const overrides: ParentalRatingOverrides = remote && typeof remote === 'object' && !Array.isArray(remote)
      ? remote as ParentalRatingOverrides
      : {};
    persistLocal(uid, overrides);
    useParentalRatingStore.setState({ overrides, initialized: true });
  }, () => {
    if (auth.currentUser?.uid !== uid) return;
    useParentalRatingStore.setState({ initialized: true });
  });
}

auth.onAuthStateChanged(user => activateParentalRatingScope(user?.uid));

export function getParentalRatingOverride(
  mediaType: ParentalMediaType,
  tmdbId: number,
): ParentalRatingOverride | null {
  return useParentalRatingStore.getState().overrides[parentalRatingKey(mediaType, tmdbId)] || null;
}
