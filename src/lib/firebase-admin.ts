import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import {
  SEENIT_FIREBASE_PROJECT_ID,
  SEENIT_FIRESTORE_DATABASE_ID
} from '../config/seenit';

if (!getApps().length) {
  initializeApp({
    projectId: SEENIT_FIREBASE_PROJECT_ID,
  });
}

export const adminAuth = getAuth();
export const adminDb = getFirestore(SEENIT_FIRESTORE_DATABASE_ID);
export const adminMessaging = getMessaging();
