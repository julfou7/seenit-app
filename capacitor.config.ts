import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.seenit.app',
  appName: 'SeenIt',
  webDir: 'dist',
  backgroundColor: '#040406',
  server: {
    androidScheme: 'https',
    hostname: 'localhost',
    cleartext: true
  },
  overrideUserAgent: "Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  plugins: {
    CapacitorHttp: {
      enabled: false
    },
    StatusBar: {
      overlaysWebView: false,
      backgroundColor: '#040406',
      style: 'DARK'
    },
    SplashScreen: {
      launchShowDuration: 3000,
      launchAutoHide: false,
      backgroundColor: '#040406',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    GoogleAuth: {
      scopes: ['profile', 'email'],
      serverClientId: '799043440232-i9s1l0jaerljg58v3oooleuemnhnim4o.apps.googleusercontent.com',
      forceCodeForRefreshToken: true,
    },
    FirebaseAuthentication: {
      skipNativeAuth: true,
      providers: ["google.com"],
      authDomain: "gen-lang-client-0201895414.firebaseapp.com"
    },
    LocalNotifications: {
      smallIcon: "ic_stat_seenit",
      iconColor: "#E5A93D"
    }
  }
};

export default config;
