import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    const errorMsg = event.reason?.message || '';
    if (errorMsg.includes('INTERNAL ASSERTION FAILED')) {
      console.error('Firestore IndexedDB corruption detected. Reloading...');
      // Nettoyage radical de l'indexeddb Firestore pour éviter une boucle de crash
      indexedDB.deleteDatabase('firestore/[DEFAULT]/ais-dev-mooctibtw2amkshvkzlqij-700628279309/main');
      indexedDB.deleteDatabase('firestore/[DEFAULT]/ais-pre-mooctibtw2amkshvkzlqij-700628279309/main');
      setTimeout(() => window.location.reload(), 1000);
    }
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
