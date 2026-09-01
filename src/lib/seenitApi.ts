import { Capacitor } from '@capacitor/core';

export const SEENIT_API_ORIGIN = 'https://seenit.ai.studio';

export function resolveSeenItApiUrl(input: string, native = Capacitor.isNativePlatform()): string {
  if (!native || !input.startsWith('/api/')) return input;
  return `${SEENIT_API_ORIGIN}${input}`;
}
