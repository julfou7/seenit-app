export const PLEX_AVAILABILITY_BACKGROUND_V1 = 'plexAvailabilityBackgroundV1';

export type NotificationPlatform = 'web' | 'android';

export function notificationCapabilitiesForPlatform(platform: NotificationPlatform): string[] {
  return platform === 'android' ? [PLEX_AVAILABILITY_BACKGROUND_V1] : [];
}

export function supportsPlexAvailabilityBackgroundV1(
  platform: NotificationPlatform,
  rawCapabilities: unknown
): boolean {
  return platform === 'android'
    && Array.isArray(rawCapabilities)
    && rawCapabilities.some(value => value === PLEX_AVAILABILITY_BACKGROUND_V1);
}
