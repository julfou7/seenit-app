import { createHash, timingSafeEqual } from 'node:crypto';

export interface NotificationDeviceCandidate {
  ownerUid: string;
  token: string;
  platform: 'web' | 'android';
}

export function hashDownloadSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function downloadSecretMatches(expectedHash: string, secret: string): boolean {
  const expected = Buffer.from(expectedHash, 'hex');
  const actual = Buffer.from(hashDownloadSecret(secret), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function isInvalidFcmTokenError(code?: string): boolean {
  return code === 'messaging/registration-token-not-registered'
    || code === 'messaging/invalid-registration-token'
    || code === 'messaging/invalid-argument';
}

export function selectUserNotificationDevices(
  uid: string,
  candidates: NotificationDeviceCandidate[]
): NotificationDeviceCandidate[] {
  const seenTokens = new Set<string>();
  return candidates.filter(candidate => {
    const token = candidate.token.trim();
    if (candidate.ownerUid !== uid || token.length <= 20 || seenTokens.has(token)) return false;
    seenTokens.add(token);
    return true;
  });
}

export function isAllowedServiceProxyPath(rawUrl: string, method: string): boolean {
  let pathname = '';
  try {
    pathname = new URL(rawUrl).pathname.replace(/\/+$/, '') || '/';
  } catch {
    return false;
  }
  const allowed: Array<{ method: string; path: RegExp }> = [
    { method: 'GET', path: /^\/api\/v3\/(?:system\/status|qualityprofile|rootfolder|series(?:\/lookup)?|episode|movie(?:\/lookup)?|queue|history|release)$/ },
    { method: 'POST', path: /^\/api\/v3\/(?:series|movie|command|release(?:\/push)?)$/ },
    { method: 'PUT', path: /^\/api\/v3\/(?:series|movie)(?:\/\d+)?$|^\/api\/v3\/episode\/\d+$/ },
    { method: 'DELETE', path: /^\/api\/v3\/queue\/\d+$/ },
    { method: 'GET', path: /^\/api\/v2\/(?:app\/version|torrents\/info)$/ },
    { method: 'POST', path: /^\/api\/v2\/(?:auth\/login|torrents\/add|torrents\/delete)$/ }
  ];
  return allowed.some(rule => rule.method === method && rule.path.test(pathname));
}
