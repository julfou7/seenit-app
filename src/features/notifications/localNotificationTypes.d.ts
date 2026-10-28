import '@capacitor/local-notifications';
declare module '@capacitor/local-notifications' {
  interface LocalNotificationSchema { subText?: string; }
}
