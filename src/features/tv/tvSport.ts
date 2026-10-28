import type { Application, RequestHandler } from 'express';
import { createHash } from 'node:crypto';

export type SportSourceId = 'monaco' | 'france-men';
export interface SportTeam { name: string; logo: string }
export interface SportEvent {
  id: string; sourceId: SportSourceId; sourceUrl: string; kickoff: string;
  home: SportTeam; away: SportTeam; competition: string; venue: string;
  confirmed: boolean;
  // Reserved for future free providers; the fixtures MVP never populates these fields.
  score?: { home: number; away: number }; status?: 'SCHEDULED' | 'LIVE' | 'FINISHED';
}
export const SPORT_SOURCES = [
  { id: 'monaco' as const, name: 'AS Monaco', url: 'https://www.asmonaco.com/fr/pros/calendrier' },
  { id: 'france-men' as const, name: 'FFF · France A', url: 'https://www.fff.fr/selection/2-equipe-de-france/resultats-et-calendrier.html' },
];
const TTL = 6 * 60 * 60_000, RETRY = 30 * 60_000, MAX_AGE = 48 * 60 * 60_000;
const MAX_HTML = 1024 * 1024;
export const FRANCE_TICKETS = 'https://billetterie.fff.fr/fr';
function text(html: string) {
  return html.replace(/<[^>]*>/g, ' ').replace(/&#(\d+);/g, (_s, n: string) => Number(n) < 65536 ? String.fromCharCode(Number(n)) : '')
    .replace(/&#x([a-f\d]+);/gi, (_s, n: string) => Number.parseInt(n, 16) < 65536 ? String.fromCharCode(Number.parseInt(n, 16)) : '')
    .replace(/&(?:amp|quot|apos|nbsp|lt|gt);/g, s => ({ '&amp;': '&', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ', '&lt;': '<', '&gt;': '>' })[s] || '')
    .replace(/\s+/g, ' ').trim().slice(0, 200);
}
function contents(html: string, tag: string, className: string) {
  const pattern = new RegExp('<' + tag + '\\b[^>]*class="[^"]*\\b' + className + '\\b[^"]*"[^>]*>([\\s\\S]*?)</' + tag + '>', 'g');
  return Array.from(html.matchAll(pattern), m => m[1]);
}
function logo(html: string, origin: string) {
  const path = /<img\b[^>]*\bsrc="([^"]+)"/.exec(html)?.[1];
  if (!path || path.length > 500) return '';
  try { const url = new URL(path, origin); return url.protocol === 'https:' && url.origin === origin ? url.href : ''; } catch { return ''; }
}
export function parseMonaco(html: string): SportEvent[] {
  const events: SportEvent[] = [];
  for (const block of html.split('data-component="MatchPresentationCard"').slice(1, 121)) {
    const date = /<time\b[^>]*datetime="([^"]+)"/.exec(block)?.[1];
    const names = contents(block, 'span', 'matchPresCardTeamName').map(text);
    const logos = contents(block, 'span', 'matchPresCardTeamLogo');
    const path = /<a\b[^>]*href="(\/fr\/[^"?#]+)"/.exec(block)?.[1];
    const meta = /<p\b[^>]*>([\s\S]*?)<\/p>/.exec(block)?.[1]?.split(/<br\s*\/?\s*>/i) || [];
    const kickoff = date ? Date.parse(date.replace(' ', 'T')) : NaN;
    if (names.length !== 2 || !Number.isFinite(kickoff) || !text(meta[0] || '')) continue;
    const sourceUrl = path ? new URL(path, 'https://www.asmonaco.com').href : SPORT_SOURCES[0].url;
    // The publisher has no match URL/ID on many provisional cards. This snapshot key
    // identifies that exact published row; it is never used to match a watched media item.
    const id = 'monaco:' + createHash('sha256').update(date + '|' + names.join('|')).digest('hex').slice(0, 24);
    events.push({ id, sourceId: 'monaco', sourceUrl, kickoff: new Date(kickoff).toISOString(),
      home: { name: names[0], logo: logo(logos[0] || '', 'https://www.asmonaco.com') },
      away: { name: names[1], logo: logo(logos[1] || '', 'https://www.asmonaco.com') },
      competition: text(meta[0]), venue: text(meta[1] || ''), confirmed: !block.includes('matchPresCardMetaWarn'),
    });
  }
  return events;
}
const months = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export function parisKickoff(year: number, month: number, day: number, hour: number, minute: number) {
  const wall = Date.UTC(year, month, day, hour, minute);
  if (!Number.isFinite(wall) || month < 0 || month > 11 || day < 1 || day > 31 || hour > 23 || minute > 59) return NaN;
  let utc = wall;
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  for (let i = 0; i < 2; i++) {
    const parts = Object.fromEntries(formatter.formatToParts(utc).map(p => [p.type, p.value]));
    const shown = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
    utc -= shown - wall;
  }
  return utc;
}
export function parseFrance(html: string): SportEvent[] {
  const events: SportEvent[] = [];
  const blocks = html.split(/<h3\b[^>]*class="[^"]*\bseason__title--journee--edf\b[^"]*"[^>]*>/).slice(1, 161);
  for (const block of blocks) {
    const header = text(block.split('</h3>')[0]);
    const date = / - \S+ (\d{1,2}) (\S+) (\d{4}) - (\d{2}):(\d{2})(?: - (.*))?$/.exec(header);
    const names = contents(block, 'h3', 'aside-resultat_team__name').map(text);
    const path = /<a\b[^>]*href=["']?(\/selection\/matchs\/[a-z\d-]+\.html)/.exec(block)?.[1];
    if (!date || !path || names.length !== 2) continue;
    const kickoff = parisKickoff(Number(date[3]), months.indexOf(date[2]), Number(date[1]), Number(date[4]), Number(date[5]));
    if (!Number.isFinite(kickoff)) continue;
    const sourceUrl = 'https://www.fff.fr' + path;
    events.push({ id: sourceUrl, sourceId: 'france-men', sourceUrl, kickoff: new Date(kickoff).toISOString(),
      home: { name: names[0], logo: '' }, away: { name: names[1], logo: '' },
      competition: header.split(' - ')[0], venue: date[6] || '', confirmed: true,
    });
  }
  return events;
}
export function parseFranceTickets(html: string): SportEvent[] {
  const starts = Array.from(html.matchAll(/<div\b[^>]*data-direction="(?:row|column)"[^>]*data-event="\d+"[^>]*>/g));
  const events = new Map<string, SportEvent>();
  for (let i = 0; i < starts.length && i < 80; i++) {
    const block = html.slice(starts[i].index, starts[i + 1]?.index);
    if (text(contents(block, 'span', 'badge-event')[0] || '') !== 'ÉQUIPE DE FRANCE') continue;
    const participants = block.split(/<div class="participant (?:first|second)">/).slice(1, 3);
    const names = participants.map(p => text(contents(p, 'span', 'name')[0] || ''));
    const date = /(\d{1,2})\s+(\S+)\s+(\d{4})\s+(?:à|•)\s+(\d{2}):(\d{2})/i.exec(text(contents(block, 'span', 'date')[0] || ''));
    if (names.length !== 2 || names.some(n => !n) || !date) continue;
    const kickoff = parisKickoff(Number(date[3]), months.indexOf(date[2].toLowerCase()), Number(date[1]), Number(date[4]), Number(date[5]));
    if (!Number.isFinite(kickoff)) continue;
    const id = 'fff-ticket:' + createHash('sha256').update(date.slice(1).join('|') + '|' + names.join('|')).digest('hex').slice(0, 24);
    events.set(id, { id, sourceId: 'france-men', sourceUrl: FRANCE_TICKETS, kickoff: new Date(kickoff).toISOString(), confirmed: true,
      home: { name: names[0], logo: logo(participants[0], 'https://billetterie.fff.fr') },
      away: { name: names[1], logo: logo(participants[1], 'https://billetterie.fff.fr') },
      competition: text(contents(block, 'span', 'event-title')[0] || ''), venue: text(contents(block, 'span', 'venue')[0] || ''),
    });
  }
  return Array.from(events.values());
}
async function readOfficial(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: 'error', headers: { Accept: 'text/html' } });
  if (!response.ok) { await response.body?.cancel(); throw new Error('SPORT_SOURCE_HTTP_' + response.status); }
  if (!response.headers.get('content-type')?.includes('text/html') || !response.body) { await response.body?.cancel(); throw new Error('SPORT_SOURCE_CHANGED'); }
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.length; if (bytes > MAX_HTML) throw new Error('SPORT_SOURCE_TOO_LARGE'); chunks.push(part.value); }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks).toString('utf8');
}
export function createTvSportService(read: (url: string) => Promise<string> = readOfficial, now: () => number = Date.now) {
  const entries = new Map<SportSourceId, { events: SportEvent[]; fetchedAt: number; nextTry: number; failed: boolean; usedUrl?: string; failure?: string; pending?: Promise<void> }>();
  async function load(source: typeof SPORT_SOURCES[number]) {
    let entry = entries.get(source.id);
    if (!entry) { entry = { events: [], fetchedAt: 0, nextTry: 0, failed: false }; entries.set(source.id, entry); }
    if (entry.pending) { await entry.pending; return; }
    if (now() < entry.nextTry) return;
    const target = entry;
    target.pending = (async () => {
      try {
        let events: SportEvent[] = [];
        for (const url of source.id === 'france-men' ? [source.url, FRANCE_TICKETS] : [source.url]) {
          try {
            const html = await read(url);
            if (Buffer.byteLength(html, 'utf8') > MAX_HTML) throw new Error('SPORT_SOURCE_TOO_LARGE');
            events = source.id === 'monaco' ? parseMonaco(html) : url === FRANCE_TICKETS ? parseFranceTickets(html) : parseFrance(html);
            if (!events.length) throw new Error('SPORT_SOURCE_CHANGED');
            target.usedUrl = url; break;
          } catch (error) {
            target.failure = error instanceof Error && /^SPORT_SOURCE_(?:HTTP_\d{3}|TOO_LARGE|CHANGED)$/.test(error.message) ? error.message : 'SPORT_SOURCE_FETCH_FAILED';
          }
        }
        if (!events.length) throw new Error('SPORT_SOURCE_CHANGED');
        target.events = events.slice(0, 120); target.fetchedAt = now(); target.nextTry = now() + TTL; target.failed = false;
      } catch { target.nextTry = now() + RETRY; target.failed = true; }
    })();
    await target.pending; target.pending = undefined;
  }
  return {
    async schedule() {
      await Promise.all(SPORT_SOURCES.map(load));
      const sources = SPORT_SOURCES.map(source => { const e = entries.get(source.id)!; return { ...source, url: e.usedUrl || source.url, fetchedAt: e.fetchedAt || null, failure: e.failed ? e.failure || 'SPORT_SOURCE_CHANGED' : null, state: e.fetchedAt && now() - e.fetchedAt <= MAX_AGE ? e.failed ? 'stale' : 'ready' : 'unavailable' }; });
      const seen = new Set<string>();
      const events = Array.from(entries.values()).filter(e => e.fetchedAt && now() - e.fetchedAt <= MAX_AGE).flatMap(e => e.events)
        .filter(e => Date.parse(e.kickoff) > now() && Date.parse(e.kickoff) < now() + 120 * 86400_000 && !seen.has(e.id) && !!seen.add(e.id))
        .sort((a, b) => a.kickoff.localeCompare(b.kickoff)).slice(0, 24);
      return { events, sources, fetchedAt: Math.max(0, ...sources.map(s => s.fetchedAt || 0)), refreshAfterMs: TTL, spoilerPolicy: 'hide' as const };
    },
  };
}
export function registerTvSportRoutes(app: Application, rateLimit: (name: string, limit: number, windowMs: number) => RequestHandler, service = createTvSportService()) {
  app.get('/api/tv/sport', rateLimit('tv-sport', 20, 60_000), async (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=1800');
    res.json(await service.schedule());
  });
}
