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
  updates: 'seenit_updates',
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
  // #909 (retour terrain du 08/11 : « mon téléphone ne vibre pas ») : la nouvelle version passait par
  // `seenit_app`, en importance basse (silencieuse). Android interdit de relever l'importance d'un canal
  // existant : la mise à jour a son propre canal, en importance haute (son, vibration, bannière).
  { id: SEENIT_NOTIFICATION_CHANNELS.updates, name: 'Mises à jour de SeenIt', description: 'Nouvelle version disponible ou téléchargée', importance: 4, vibration: true },
];

let ensurePromise: Promise<void> | null = null;

/** Catégorie de secours créée par Firebase quand une notification arrive avant sa catégorie (« Miscellaneous »). */
export const FCM_FALLBACK_CHANNEL_ID = 'fcm_fallback_notification_channel';
/** Catégorie de secours de la bibliothèque de notifications, recréée à chaque démarrage (« Default »). */
export const PLUGIN_DEFAULT_CHANNEL_ID = 'default';
export const PLUGIN_DEFAULT_CHANNEL_NAME = 'Autres';

/**
 * Demande du 15/11 : « Default » et « Miscellaneous » n'ont aucun sens pour l'utilisateur. La catégorie de
 * secours Firebase est supprimée (Firebase ne la recrée qu'en cas de besoin) ; celle de la bibliothèque, qu'on
 * ne peut pas supprimer durablement, est renommée « Autres » en gardant l'importance choisie par l'utilisateur.
 */
export function planChannelHousekeeping(channels: ReadonlyArray<Channel>): { remove: string[]; rename: Channel[] } {
  const remove = channels.some(channel => channel.id === FCM_FALLBACK_CHANNEL_ID) ? [FCM_FALLBACK_CHANNEL_ID] : [];
  const pluginDefault = channels.find(channel => channel.id === PLUGIN_DEFAULT_CHANNEL_ID);
  const rename = pluginDefault && pluginDefault.name !== PLUGIN_DEFAULT_CHANNEL_NAME
    ? [{ ...pluginDefault, name: PLUGIN_DEFAULT_CHANNEL_NAME, description: 'Notifications sans catégorie dédiée' }]
    : [];
  return { remove, rename };
}

/**
 * Canaux SeenIt bloqués par l'utilisateur dans Android (importance NONE = 0). Hors Android ou en cas
 * d'échec de lecture : aucun canal considéré bloqué (le comportement historique est conservé).
 */
export const readBlockedSeenItChannels = async (): Promise<Set<string>> => {
  if (Capacitor.getPlatform() !== 'android') return new Set();
  try {
    const { channels } = await LocalNotifications.listChannels();
    return new Set(channels.filter(channel => channel.id.startsWith('seenit_') && channel.importance === 0).map(channel => channel.id));
  } catch {
    return new Set();
  }
};

/**
 * SEENIT-NOTIFICATION-006 — crée uniquement les nouveaux canaux SeenIt (huit depuis #909).
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
    // Ménage des catégories techniques : jamais bloquant pour la création des catégories SeenIt.
    const housekeeping = planChannelHousekeeping(existing.channels);
    for (const id of housekeeping.remove) await LocalNotifications.deleteChannel({ id }).catch(() => undefined);
    for (const channel of housekeeping.rename) await LocalNotifications.createChannel(channel).catch(() => undefined);
  })().catch(error => {
    ensurePromise = null;
    throw error;
  });

  return ensurePromise;
};
