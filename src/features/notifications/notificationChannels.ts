import { Capacitor } from '@capacitor/core';
import { LocalNotifications, type Channel } from '@capacitor/local-notifications';

export const SEENIT_NOTIFICATION_CHANNELS = {
  episodes: 'seenit_episodes',
  reminders: 'seenit_reminders',
  movies: 'seenit_movies',
  summary: 'seenit_summary',
  plex: 'seenit_plex',
  news: 'seenit_news',
  app: 'seenit_app',
  downloads: 'seenit_downloads',
} as const;

const CHANNELS: ReadonlyArray<Channel> = [
  { id: SEENIT_NOTIFICATION_CHANNELS.episodes, name: 'Épisodes et saisons', importance: 4 },
  { id: SEENIT_NOTIFICATION_CHANNELS.reminders, name: 'Rappels', importance: 4 },
  { id: SEENIT_NOTIFICATION_CHANNELS.movies, name: 'Films', importance: 3 },
  { id: SEENIT_NOTIFICATION_CHANNELS.summary, name: 'Résumé du soir', importance: 3 },
  { id: SEENIT_NOTIFICATION_CHANNELS.plex, name: 'Plex', importance: 2 },
  { id: SEENIT_NOTIFICATION_CHANNELS.news, name: 'Actualités et reprises', importance: 2 },
  { id: SEENIT_NOTIFICATION_CHANNELS.app, name: 'Application', importance: 2 },
];

let ensurePromise: Promise<void> | null = null;

/**
 * SEENIT-NOTIFICATION-006 — crée uniquement les nouveaux canaux SeenIt.
 * `seenit_downloads` est volontairement absent : il existe déjà et ses choix système
 * doivent être conservés au lieu d'être recréés/réinitialisés par la refonte #778.
 */
export const ensureSeenItNotificationChannels = async (): Promise<void> => {
  if (Capacitor.getPlatform() !== 'android') return;
  if (ensurePromise) return ensurePromise;

  ensurePromise = (async () => {
    const existing = await LocalNotifications.listChannels();
    const ids = new Set(existing.channels.map(channel => channel.id));
    for (const channel of CHANNELS) {
      if (!ids.has(channel.id)) {
        await LocalNotifications.createChannel(channel);
      }
    }
  })().catch(error => {
    ensurePromise = null;
    throw error;
  });

  return ensurePromise;
};
