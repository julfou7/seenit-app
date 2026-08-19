import { useState, useEffect } from 'react';
import { signInWithPopup, signInWithCredential, GoogleAuthProvider, getRedirectResult } from 'firebase/auth';
import { GoogleAuth } from '@codetrix-studio/capacitor-google-auth';
import { auth, googleAuthProvider } from '../lib/firebase';
import { LogIn, Tv2, Film, Clapperboard, Sparkles } from 'lucide-react';
import { PWAInstallBanner } from '../components/PWAInstallBanner';
import { SeenItLogo } from '../components/SeenItLogo';
import { Capacitor } from '@capacitor/core';

export function LoginScreen() {
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getRedirectResult(auth)
      .then((result) => {
         if (result) {
            setIsLoggingIn(false);
         }
      })
      .catch((err: any) => {
        console.warn('Redirect auth result check:', err);
        if (err?.message) setError(err.message);
        setIsLoggingIn(false);
      });
  }, []);

  const handleResetCache = () => {
    try {
      indexedDB.deleteDatabase('firebaseLocalStorageDb');
      window.location.reload();
    } catch (e) {
      console.error(e);
    }
  };

  const handleLogin = async () => {
    setIsLoggingIn(true);
    setError('');

    try {
      if (Capacitor.isNativePlatform()) {
        // 1. FLUX NATIF MOBILE (APK Android)
        await GoogleAuth.initialize({
          clientId: '799043440232-i9s1l0jaerljg58v3oooleuemnhnim4o.apps.googleusercontent.com',
          scopes: ['profile', 'email'],
          grantOfflineAccess: true,
        });
        const googleUser = await GoogleAuth.signIn();
        const idToken = googleUser.authentication?.idToken || (googleUser as any)?.idToken;
        if (!idToken) {
          throw new Error("Jeton d'authentification Google manquant.");
        }
        const credential = GoogleAuthProvider.credential(idToken);
        await signInWithCredential(auth, credential);
      } else {
        // 2. FLUX WEB STANDARD (Navigateur)
        await signInWithPopup(auth, googleAuthProvider);
      }
    } catch (err: any) {
      console.warn("Erreur d'authentification Google :", err);
      const errMsg = err?.message || (typeof err === 'string' ? err : JSON.stringify(err)) || "Une erreur s'est produite lors de la connexion.";
      setError(errMsg);
    } finally {
      setIsLoggingIn(false);
    }
  };

  return (
    <div className="w-full min-h-[100dvh] bg-[#040406] flex justify-center selection:bg-[#E5A93D]/30">
      <div className="w-full max-w-md bg-premium-ambient h-[100dvh] flex flex-col relative shadow-2xl shadow-black/90 overflow-hidden">
        <PWAInstallBanner />
        
        <div className="flex-1 flex flex-col items-center justify-center p-8 relative z-10">
          
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            {/* Background elements to make it look premium */}
            <div className="absolute top-[-10%] right-[-20%] w-[150%] h-[50%] bg-[#E5A93D]/5 blur-[120px] rounded-full mix-blend-screen" />
            <div className="absolute bottom-[-10%] left-[-20%] w-[120%] h-[50%] bg-blue-500/5 blur-[100px] rounded-full mix-blend-screen" />
          </div>

          <div className="relative z-10 w-full flex flex-col items-center justify-center text-center">
            <div className="mb-6 relative group flex items-center justify-center">
              {/* Soft gold ambient bloom behind the app icon */}
              <div className="absolute inset-0 bg-[#E5A93D]/25 blur-[28px] rounded-full scale-110 pointer-events-none" />
              <SeenItLogo variant="icon" size={88} animated />
            </div>

            <h1 className="text-4xl font-black text-white mb-1.5 tracking-tight flex items-center justify-center gap-1">
              <span>Seen</span>
              <span className="bg-gradient-to-r from-[#FFE28A] via-[#F5C518] to-[#E5A93D] bg-clip-text text-transparent">
                It
              </span>
            </h1>
            
            <h2 className="text-xs font-semibold text-zinc-400 mb-6 tracking-widest uppercase">
              L'expérience cinéma & séries
            </h2>

            <p className="text-zinc-400 text-sm mb-12 max-w-[280px] leading-relaxed">
              Synchronisez votre historique avec Plex et centralisez votre liste de visionnage.
            </p>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs px-4 py-3 rounded-xl mb-6 w-full max-w-[280px] flex flex-col gap-3">
                <div className="text-center">{error}</div>
                <button 
                  onClick={handleResetCache}
                  className="bg-red-500/20 hover:bg-red-500/30 text-red-300 py-2 rounded-lg font-medium transition-colors"
                >
                  Réparer (Vider le cache)
                </button>
              </div>
            )}

            <button
              onClick={handleLogin}
              disabled={isLoggingIn}
              className="w-full max-w-[280px] flex items-center justify-center gap-3 bg-white text-zinc-950 font-bold py-3.5 px-6 rounded-2xl [@media(hover:hover)]:hover:bg-zinc-200 active:bg-zinc-300 transition-all cursor-pointer touch-manipulation select-none disabled:opacity-70 disabled:scale-95 shadow-[0_0_40px_-10px_rgba(255,255,255,0.3)]"
            >
              {isLoggingIn ? (
                <div className="w-5 h-5 border-2 border-zinc-900 border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.16v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.16C1.43 8.55 1 10.22 1 12s.43 3.45 1.16 4.93l2.85-2.22.83-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.16 7.07l3.68 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  Continuer avec Google
                </>
              )}
            </button>
            
            <div className="mt-8 flex items-center justify-center gap-2 text-zinc-500 text-xs">
              <Sparkles className="w-4 h-4 text-zinc-600" />
              <span>Accès réservé. Connexion requise.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
