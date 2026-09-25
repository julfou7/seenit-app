export const CANAL_ANDROID_PACKAGE = 'com.canal.android.canal';
export const CANAL_WEB_URL = 'https://www.canalplus.com/';

export function isCanalWebUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    return parsed.protocol === 'https:' && (host === 'www.canalplus.com' || host === 'canalplus.com');
  } catch {
    return false;
  }
}
