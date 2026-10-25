import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { LocalNotifications } from '@capacitor/local-notifications';
import { readUserScopedJson, writeUserScopedJson } from '../../lib/userIsolation';
import type { Show } from '../../types';
export const NOTIFICATION_INBOX_FIELD = 'notification_inbox_v1';
export interface InboxNotification { id: string; title: string; body: string; data: Record<string, unknown>; receivedAt: number }
export async function rememberNotification(uid: string | null | undefined, raw: { id?: unknown; title?: unknown; body?: unknown; data?: unknown; extra?: unknown }) {
  if (!uid || !raw.title) return;
  const data = raw.data || raw.extra || {};
  if (typeof data !== 'object' || data === null) return;
  const owner = data as Record<string, unknown>;
  if (!owner.uid && !owner.ownerUid && !owner.ownerUidHash) return;
  if (owner.uid && owner.uid !== uid || owner.ownerUid && owner.ownerUid !== uid) return;
  if (owner.ownerUidHash) {
    try {
      const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(uid));
      const hash = [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 16);
      if (owner.ownerUidHash !== hash) return;
    } catch { return; }
  }
  const item = { id: String(raw.id || `${raw.title}:${raw.body || ''}`), title: String(raw.title), body: String(raw.body || ''), data: Object.fromEntries(Object.entries(owner).filter(([key]) => ['showId','tmdbId','mediaType','season','episode','type'].includes(key))), receivedAt: Date.now() };
  const previous = readUserScopedJson<InboxNotification[]>(uid, NOTIFICATION_INBOX_FIELD, []);
  writeUserScopedJson(uid, NOTIFICATION_INBOX_FIELD, [item, ...previous.filter(entry => entry.id !== item.id)].slice(0, 100));
}
export async function collectDeliveredNotifications(uid: string, currentUid: () => string | undefined, shows: readonly Show[]) {
  if (!Capacitor.isNativePlatform()) return;
  const results = await Promise.allSettled([PushNotifications.getDeliveredNotifications(), LocalNotifications.getDeliveredNotifications()]);
  if (currentUid() !== uid) return;
  for (const result of results) if (result.status === 'fulfilled') for (const raw of result.value.notifications) {
    const data: Record<string, unknown> = ('data' in raw ? raw.data : raw.extra) || {};
    // A shared media identity is never proof of ownership. Ignore legacy ownerless alerts.
    if (!data.uid && !data.ownerUid && !data.ownerUidHash) continue;
    if (data.ownerUid && data.ownerUid !== uid || data.uid && data.uid !== uid) continue;
    if (data.ownerUidHash) {
      const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(uid));
      const hash = [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 16);
      if (data.ownerUidHash !== hash || currentUid() !== uid) continue;
    }
    if (!shows.some(show => show.userId === uid && (String(show.id) === String(data.showId) || Number(show.tmdbId) === Number(data.tmdbId) && show.mediaType === (data.mediaType || 'tv')))) continue;
    await rememberNotification(uid, { ...raw, data });
  }
}
export function formatNotificationEpisodeCodes(text: string): string {
  return text.replace(/\bS(\d{1,2})\s*[·|]?\s*E(\d{1,3})\b/g, (_match, season: string, episode: string) => `S${season.padStart(2, '0')} | E${episode.padStart(2, '0')}`);
}
