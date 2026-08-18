import React, { useEffect, useState } from 'react';
import { Download, X, Smartphone } from 'lucide-react';
import { SeenItLogo } from './SeenItLogo';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function PWAInstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    // Check if already running as PWA
    const isStandaloneApp = window.matchMedia('(display-mode: standalone)').matches 
      || (navigator as any).standalone 
      || document.referrer.includes('android-app://');
    
    if (isStandaloneApp) {
      setIsStandalone(true);
      return;
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;

    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
    }
  };

  if (isStandalone || isDismissed || !deferredPrompt) {
    return null;
  }

  return (
    <div className="bg-gradient-to-r from-[#E5A93D]/20 via-amber-500/10 to-transparent border-b border-[#E5A93D]/30 px-4 py-3 flex items-center justify-between text-white backdrop-blur-md relative z-50">
      <div className="flex items-center gap-3">
        <SeenItLogo variant="icon" size={40} />
        <div>
          <p className="text-xs font-semibold text-white tracking-tight">Installer SeenIt</p>
          <p className="text-[11px] text-zinc-400">Ajouter à l'écran d'accueil</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={handleInstallClick}
          className="flex items-center gap-1.5 bg-[#E5A93D] hover:bg-[#d4992f] text-black text-xs font-bold px-3 py-1.5 rounded-full transition-all shadow-md active:scale-95"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Installer</span>
        </button>
        <button
          onClick={() => setIsDismissed(true)}
          className="p-1 text-zinc-400 hover:text-white rounded-full transition-colors"
          title="Fermer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
