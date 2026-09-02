import { registerPlugin } from '@capacitor/core';

export interface SeenItAuthPlugin {
  signInWithGoogle(): Promise<{ idToken: string }>;
}

export const SeenItAuth = registerPlugin<SeenItAuthPlugin>('SeenItAuth');
