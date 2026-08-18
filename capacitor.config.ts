import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.seenit.app',
  appName: 'SeenIt',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    hostname: 'gen-lang-client-0201895414.firebaseapp.com',
    cleartext: true
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      launchAutoHide: true,
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
