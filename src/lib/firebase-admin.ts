import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };

if (!getApps().length) {
  initializeApp({
    projectId: firebaseConfig.projectId,
  });
}

export const adminAuth = getAuth();
const dbId = (firebaseConfig as any).firestoreDatabaseId;
export const adminDb = dbId && dbId !== '(default)' && dbId !== 'default'
  ? getFirestore(dbId)
  : getFirestore();
