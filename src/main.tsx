import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { terminate } from 'firebase/firestore';
import App from './App.tsx';
import { db, FIRESTORE_DATABASE_ID } from './lib/firebase.ts';
import { installFirestoreIndexedDbRecovery } from './lib/firestoreRecovery.ts';
import firebaseConfig from '../firebase-applet-config.json';
import './index.css';

if (typeof window !== 'undefined') {
  const disposeFirestoreRecovery = installFirestoreIndexedDbRecovery({
    projectId: firebaseConfig.projectId,
    databaseId: FIRESTORE_DATABASE_ID,
    terminateFirestore: () => terminate(db)
  });
  import.meta.hot?.dispose(disposeFirestoreRecovery);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
