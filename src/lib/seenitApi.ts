import { Capacitor } from '@capacitor/core';
import { SEENIT_API_ORIGIN } from '../config/seenit';

export { SEENIT_API_ORIGIN } from '../config/seenit';

export function resolveSeenItApiUrl(input: string, native = Capacitor.isNativePlatform()): string {
  if (!native || !input.startsWith('/api/')) return input;
  return `${SEENIT_API_ORIGIN}${input}`;
}
