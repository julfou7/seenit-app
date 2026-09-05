import { APP_UPDATE_AVAILABLE_PUSH_TYPE } from './releaseUpdatePushCore.ts';

export interface AppUpdateAvailablePushData {
  type: typeof APP_UPDATE_AVAILABLE_PUSH_TYPE;
  version: string;
}

const VERSION_RE = /^\d+\.\d+\.\d+$/;
let pendingAppUpdateAvailablePush: AppUpdateAvailablePushData | null = null;

export function isAppUpdateAvailablePush(data: unknown): data is AppUpdateAvailablePushData {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const candidate = data as Record<string, unknown>;
  return candidate.type === APP_UPDATE_AVAILABLE_PUSH_TYPE
    && typeof candidate.version === 'string'
    && VERSION_RE.test(candidate.version.trim());
}

export function queueAppUpdateAvailablePush(data: unknown): boolean {
  if (!isAppUpdateAvailablePush(data)) return false;
  pendingAppUpdateAvailablePush = {
    type: APP_UPDATE_AVAILABLE_PUSH_TYPE,
    version: data.version.trim()
  };
  return true;
}

export function consumeAppUpdateAvailablePush(): AppUpdateAvailablePushData | null {
  const pending = pendingAppUpdateAvailablePush;
  pendingAppUpdateAvailablePush = null;
  return pending;
}

export async function handleAppUpdateAvailablePush(  data: unknown,
  checkForUpdates: (force?: boolean) => Promise<boolean>
): Promise<boolean> {
  if (!isAppUpdateAvailablePush(data)) return false;
  await checkForUpdates(true);
  return true;
}
