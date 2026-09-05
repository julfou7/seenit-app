import { Capacitor } from '@capacitor/core';

export const SEENIT_API_ORIGIN = 'https://seenit.ai.studio';
export const SEENIT_API_FALLBACK_ORIGIN = 'https://seenit-app-799043440232.us-west1.run.app';

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

export function resolveSeenItApiCandidates(
  input: string,
  native = Capacitor.isNativePlatform(),
  hostname = currentBrowserHostname()
): string[] {
  const primary = resolveSeenItApiUrl(input, native, hostname);
  if (!native || !input.startsWith('/api/')) return [primary];

  return [primary, `${SEENIT_API_FALLBACK_ORIGIN}${input}`];
}
