const SENSITIVE_KEY = /(authorization|cookie|password|secret|token|api[_-]?key|sid)/i;
const MAX_DEPTH = 5;
const MAX_STRING_LENGTH = 4_000;

export function getUserLogStorageKey(uid: string): string {
  const normalizedUid = String(uid || '').trim();
  if (!normalizedUid) throw new Error('UID requis pour le stockage des logs.');
  return `app_activity_logs_v2:${normalizedUid}`;
}

function redactString(input: string): string {
  return input
    .slice(0, MAX_STRING_LENGTH)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [MASQUÉ]')
    .replace(/([?&](?:token|apikey|api_key|secret|sid)=)[^&#\s]+/gi, '$1[MASQUÉ]')
    .replace(/(X-Plex-Token\s*[:=]\s*)[^\s,;]+/gi, '$1[MASQUÉ]');
}

export function sanitizeLogDetails(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[PROFONDEUR LIMITÉE]';
  if (typeof value === 'string') return redactString(value);
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message) };
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map(entry => sanitizeLogDetails(entry, depth + 1));
  }
  if (typeof value === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
      sanitized[key] = SENSITIVE_KEY.test(key) ? '[MASQUÉ]' : sanitizeLogDetails(entry, depth + 1);
    }
    return sanitized;
  }
  return redactString(String(value));
}
