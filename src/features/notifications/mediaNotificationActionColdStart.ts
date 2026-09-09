export type MediaNotificationActionPayload = {
  type?: string;
  showId?: string | number;
  tmdbId?: number;
  mediaType?: string;
  season?: number;
  episode?: number;
  url?: string;
  __seenitMediaActionReplay?: boolean;
  [key: string]: unknown;
};

const MAX_PENDING_MEDIA_ACTIONS = 8;
const REPLAY_MARKER = '__seenitMediaActionReplay';

function isMediaNotificationAction(payload: MediaNotificationActionPayload | null | undefined): boolean {
  return payload?.type === 'NAVIGATE_SHOW' || payload?.type === 'QUICK_ACTION_MARK_WATCHED';
}

/**
 * Buffer très court du démarrage natif. Le listener Firebase peut recevoir le
 * clic Android avant que l'effet React d'App n'écoute l'événement DOM ; dans ce
 * cas on intercepte l'événement original puis on le rejoue une seule fois après
 * le chargement. Hors fenêtre de démarrage, aucun événement n'est retardé.
 */
export function createMediaNotificationColdStartBuffer(
  replay: (payload: MediaNotificationActionPayload) => void,
) {
  let buffering = true;
  const pending: MediaNotificationActionPayload[] = [];

  return {
    capture(payload: MediaNotificationActionPayload | null | undefined): boolean {
      if (!buffering || !isMediaNotificationAction(payload) || payload?.[REPLAY_MARKER]) return false;
      if (pending.length < MAX_PENDING_MEDIA_ACTIONS) pending.push({ ...payload });
      return true;
    },
    flush(): void {
      if (!buffering) return;
      buffering = false;
      for (const payload of pending.splice(0)) {
        replay({ ...payload, [REPLAY_MARKER]: true });
      }
    },
    pendingCount(): number {
      return pending.length;
    },
  };
}

export function installMediaNotificationColdStartReplay(): () => void {
  if (typeof window === 'undefined') return () => undefined;

  const buffer = createMediaNotificationColdStartBuffer(payload => {
    window.dispatchEvent(new CustomEvent('capacitor-notification-action', { detail: payload }));
  });

  const onAction = (event: Event) => {
    const payload = (event as CustomEvent<MediaNotificationActionPayload>).detail;
    if (buffer.capture(payload)) {
      // Ce module est évalué avant App/firebase depuis main.tsx : le bridge est
      // donc en place avant que Capacitor puisse redispatcher l'action native.
      event.stopImmediatePropagation();
    }
  };

  let flushTimer: number | undefined;
  const flushAfterAppMount = () => {
    flushTimer = window.setTimeout(() => buffer.flush(), 300);
  };

  window.addEventListener('capacitor-notification-action', onAction);
  if (document.readyState === 'complete') {
    flushAfterAppMount();
  } else {
    window.addEventListener('load', flushAfterAppMount, { once: true });
  }

  return () => {
    if (flushTimer !== undefined) window.clearTimeout(flushTimer);
    window.removeEventListener('load', flushAfterAppMount);
    window.removeEventListener('capacitor-notification-action', onAction);
    buffer.flush();
  };
}

// L'installation au moment de l'évaluation du module est volontaire : main.tsx
// importe ce module avant App, donc le clic natif ne peut plus se glisser entre
// l'enregistrement Firebase et le montage du listener React.
export const disposeMediaNotificationColdStartReplay = installMediaNotificationColdStartReplay();
