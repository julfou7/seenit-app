import { registerPlugin } from '@capacitor/core';

export interface SeenItGoogleCredential {
  idToken: string;
  displayName?: string;
  photoURL?: string;
}

export interface SeenItAuthPlugin {
  signInWithGoogle(): Promise<SeenItGoogleCredential>;
}

export const SeenItAuth = registerPlugin<SeenItAuthPlugin>('SeenItAuth');
