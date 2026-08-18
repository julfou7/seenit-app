import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.seenit.app',
  appName: 'SeenIt',
  webDir: 'dist',
  // Configuration pour le Live Web View (Pointer vers l'URL de production)
  server: {
    url: 'https://ais-pre-mooctibtw2amkshvkzlqij-700628279309.europe-west2.run.app',
    cleartext: true
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 10000, // Durée longue, on le cache manuellement depuis le code React
      launchAutoHide: false, // Ne pas cacher automatiquement, pour éviter un écran blanc
      backgroundColor: '#040406',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    }
  }
};

export default config;
