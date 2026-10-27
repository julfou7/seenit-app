import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const TV_PAIRING_TTL_MS = 10 * 60_000;
export const TV_SESSION_TTL_MS = 30 * 24 * 60 * 60_000;
export const TV_PAIRING_ORIGIN = 'https://seenit.ai.studio';
export interface TvLink {
  version: 1;
  secretHash: string;
  codeHash: string;
  state: 'pending' | 'active' | 'revoked';
  profile: string;
  deviceName: string;
  createdAt: number;
  expiresAt: number;
  ownerUid?: string;
  accountName?: string;
}
export interface TvLinkMutation<T> { next: TvLink; result: T }
export interface TvLinkStore {
  create(id: string, link: TvLink): Promise<void>;
  read(id: string): Promise<TvLink | null>;
  mutate<T>(id: string, change: (link: TvLink | null) => TvLinkMutation<T>): Promise<T>;
}
export class TvPairingError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code; }
}
export const hashTvSecret = (value: string) => createHash('sha256').update(value).digest('hex');
function sameHash(secret: string, expected: string) {
  return /^[a-f0-9]{64}$/.test(expected) && timingSafeEqual(Buffer.from(hashTvSecret(secret), 'hex'), Buffer.from(expected, 'hex'));
}
function identifier(value: string) {
  if (!/^[a-f0-9]{48}$/.test(value)) throw new TvPairingError(400, 'INVALID_LINK');
  return value;
}
function codeValue(value: string) {
  const code = String(value || '').replace(/[-\s]/g, '').toUpperCase();
  if (!/^[A-F0-9]{8}$/.test(code)) throw new TvPairingError(400, 'INVALID_CODE');
  return code;
}
function label(value: unknown, fallback: string, limit: number) {
  const safe = typeof value === 'string' ? value.replace(/[\x00-\x1f<>]/g, '').trim().slice(0, limit) : '';
  return safe || fallback;
}
export function createTvPairingService(store: TvLinkStore, now = () => Date.now()) {
  function live(link: TvLink | null): TvLink {
    if (!link) throw new TvPairingError(404, 'LINK_NOT_FOUND');
    if (link.state === 'revoked') throw new TvPairingError(403, 'LINK_REVOKED');
    if (link.expiresAt <= now()) throw new TvPairingError(410, 'LINK_EXPIRED');
    return link;
  }
  function withCode(link: TvLink | null, code: string, uid: string) {
    const record = live(link);
    if (!uid) throw new TvPairingError(401, 'AUTH_REQUIRED');
    if (!sameHash(codeValue(code), record.codeHash)) throw new TvPairingError(403, 'WRONG_CODE');
    if (record.ownerUid && record.ownerUid !== uid) throw new TvPairingError(409, 'ALREADY_LINKED');
    return record;
  }
  async function device(id: string, secret: string, requireActive = false) {
    identifier(id);
    if (!/^[a-f0-9]{64}$/.test(secret)) throw new TvPairingError(401, 'INVALID_TV_SESSION');
    const record = await store.read(id);
    if (!record || !sameHash(secret, record.secretHash)) throw new TvPairingError(401, 'INVALID_TV_SESSION');
    const active = live(record);
    if (requireActive && (active.state !== 'active' || !active.ownerUid)) throw new TvPairingError(403, 'APPROVAL_REQUIRED');
    return active;
  }
  return {
    async create(input: { profile?: unknown; deviceName?: unknown }) {
      const id = randomBytes(24).toString('hex');
      const secret = randomBytes(32).toString('hex');
      const code = randomBytes(4).toString('hex').toUpperCase();
      const createdAt = now();
      const record: TvLink = { version: 1, secretHash: hashTvSecret(secret), codeHash: hashTvSecret(code), state: 'pending',
        profile: label(input.profile, 'Julian', 40), deviceName: label(input.deviceName, 'SeenIt TV', 80), createdAt, expiresAt: createdAt + TV_PAIRING_TTL_MS };
      await store.create(id, record);
      const displayCode = code.slice(0, 4) + '-' + code.slice(4);
      return { id, secret, code: displayCode, profile: record.profile, expiresAt: record.expiresAt, intervalSeconds: 5,
        approvalUrl: `${TV_PAIRING_ORIGIN}/tv/connect?tvLink=${id}&code=${displayCode}` };
    },
    async inspect(id: string, code: string, uid: string) {
      const record = withCode(await store.read(identifier(id)), code, uid);
      return { state: record.state, profile: record.profile, deviceName: record.deviceName, expiresAt: record.expiresAt };
    },
    async approve(id: string, code: string, owner: { uid: string; name?: unknown }) {
      identifier(id);
      return store.mutate(id, previous => {
        const record = withCode(previous, code, owner.uid);
        const next: TvLink = record.state === 'active' ? record : { ...record, state: 'active', ownerUid: owner.uid,
          accountName: label(owner.name, 'Compte SeenIt', 80), expiresAt: now() + TV_SESSION_TTL_MS };
        return { next, result: { state: 'active' as const, profile: next.profile, expiresAt: next.expiresAt } };
      });
    },
    async status(id: string, secret: string) {
      const record = await device(id, secret);
      return { state: record.state, profile: record.profile, accountName: record.state === 'active' ? record.accountName : undefined,
        expiresAt: record.expiresAt, intervalSeconds: 5 };
    },
    device,
    async revoke(id: string, secret: string) {
      await device(id, secret);
      return store.mutate(identifier(id), previous => {
        if (!previous || !sameHash(secret, previous.secretHash)) throw new TvPairingError(401, 'INVALID_TV_SESSION');
        return { next: { ...previous, state: 'revoked', expiresAt: now() }, result: { revoked: true } };
      });
    },
  };
}
