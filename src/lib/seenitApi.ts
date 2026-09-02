import { Capacitor } from '@capacitor/core';

export const SEENIT_API_ORIGIN = 'https://seenit.ai.studio';

export function isAiStudioPreviewHostname(hostname: string): boolean {
  const normalized = String(hostname || '').trim().toLowerCase().replace(/\.$/, '');
  if (!normalized) return false;
  return normalized.split('.').some(label => label.startsWith('ais-dev-'));
}

export function isSeenItApiRequest(input: string): boolean {
  return input.startsWith('/api/') || input.startsWith(`${SEENIT_API_ORIGIN}/api/`);
}

export function isUnexpectedHtmlApiResponse(contentType: string | null): boolean {
  return /^text\/html(?:;|$)/i.test(String(contentType || '').trim());
}

function currentBrowserHostname(): string {
  try {
    return typeof window !== 'undefined' ? window.location.hostname : '';
  } catch {
    return '';
  }
}

export function resolveSeenItApiUrl(
  input: string,
  native = Capacitor.isNativePlatform(),
  hostname = currentBrowserHostname()
): string {
  if (!input.startsWith('/api/')) return input;

  // L'APK et le preview AI Studio utilisent le même backend canonique publié.
  // La PWA canonique sur seenit.ai.studio reste en même origine avec des routes relatives.
  if (native || isAiStudioPreviewHostname(hostname)) {
    return `${SEENIT_API_ORIGIN}${input}`;
  }

  return input;
}
