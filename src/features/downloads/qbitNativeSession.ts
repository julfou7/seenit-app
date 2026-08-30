function readHeader(headers: Record<string, unknown> | undefined, name: string): string {
  if (!headers) return '';
  const wanted = name.toLowerCase();
  for (const [key, rawValue] of Object.entries(headers)) {
    if (key.toLowerCase() !== wanted) continue;
    const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
    return value == null ? '' : String(value);
  }
  return '';
}

/** Extrait le SID qBittorrent d'une réponse native CapacitorHttp. */
export function extractQbitSessionCookie(headers: Record<string, unknown> | undefined): string {
  const raw = readHeader(headers, 'set-cookie');
  if (!raw) return '';
  const sid = raw.match(/(?:^|[,;\s])SID=([^;,\s]+)/i);
  return sid ? `SID=${sid[1]}` : raw.split(';')[0].trim();
}

/** Détermine si le polling peut être retenté après renouvellement de session. */
export function isQbitAuthError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return /(?:\b401\b|\b403\b|accès refusé|authentication|authentification)/i.test(message);
}
