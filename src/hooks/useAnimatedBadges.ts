import { useCallback, useSyncExternalStore } from 'react';
import { auth } from '../lib/firebase';
import { readUserScopedJson, subscribeUserScopedStorageField, writeUserScopedJson } from '../lib/userIsolation';

export function useAnimatedBadges() {
  const uid = auth.currentUser?.uid;
  const subscribe = useCallback((listener: () => void) => subscribeUserScopedStorageField(uid, 'home_animated_badges', listener), [uid]);
  const snapshot = useCallback(() => readUserScopedJson(uid, 'home_animated_badges', true), [uid]);
  const enabled = useSyncExternalStore(subscribe, snapshot, () => true);
  const setEnabled = (value: boolean) => {
    if (uid && auth.currentUser?.uid === uid) writeUserScopedJson(uid, 'home_animated_badges', value);
  };
  return [enabled, setEnabled] as const;
}
