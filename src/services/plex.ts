import { CURRENT_APP_VERSION } from '../store/updateStore';

export const PLEX_PRODUCT = 'SeenIt' as const;
export const PLEX_VERSION = CURRENT_APP_VERSION;
export type PlexAuthPlatform = 'Web' | 'Android';

export type PlexAuthAttempt = Readonly<{
  pinId: number;
  code: string;
  clientIdentifier: string;
  product: typeof PLEX_PRODUCT;
  version: string;
  platform: PlexAuthPlatform;
  createdAt: number;
  expiresAt: number;
}>;

export type PlexAccount = {
  username?: string;
  title?: string;
  email?: string;
};

export type PlexPinPollResult = {
  authToken: string | null;
  username?: string;
  account?: PlexAccount;
};

export type PlexAuthErrorCode =
  | 'cancelled'
  | 'expired'
  | 'refused'
  | 'rate_limited'
  | 'identity_mismatch'
  | 'invalid_token'
  | 'network'
  | 'provider';

export class PlexAuthError extends Error {
  readonly code: PlexAuthErrorCode;
  readonly permanent: boolean;
  readonly retryAfterMs?: number;

  constructor(
    code: PlexAuthErrorCode,
    message: string,
    options: { permanent?: boolean; retryAfterMs?: number; cause?: unknown } = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'PlexAuthError';
    this.code = code;
    this.permanent = options.permanent ?? false;
    this.retryAfterMs = options.retryAfterMs;
  }
}

type PlexRequestOptions = {
  fetchImpl?: typeof fetch;
  now?: () => number;
  signal?: AbortSignal;
};

type PlexPollOptions = PlexRequestOptions & {
  delay?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

const PLEX_PIN_URL = 'https://plex.tv/api/v2/pins';
const PLEX_USER_URL = 'https://plex.tv/api/v2/user';
const PLEX_AUTH_URL = 'https://app.plex.tv/auth';
const DEFAULT_PIN_TTL_MS = 5 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 3_000;
const MIN_RETRY_AFTER_MS = 3_000;
const MAX_RETRY_AFTER_MS = 30_000;

export const getPlexClientId = () => {
  let clientId = localStorage.getItem('plex_client_identifier');
  const isUuid = clientId && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientId);
  if (!isUuid) {
    clientId = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
          const random = (Math.random() * 16) | 0;
          const value = character === 'x' ? random : (random & 0x3) | 0x8;
          return value.toString(16);
        });
    localStorage.setItem('plex_client_identifier', clientId);
  }
  return clientId!;
};

const assertAttemptIdentity = (attempt: PlexAuthAttempt) => {
  if (
    attempt.product !== PLEX_PRODUCT
    || attempt.version !== PLEX_VERSION
    || !attempt.clientIdentifier
    || !attempt.pinId
    || !attempt.code
    || (attempt.platform !== 'Web' && attempt.platform !== 'Android')
  ) {
    throw new PlexAuthError(
      'identity_mismatch',
      "L'identité de la tentative Plex n'est plus cohérente.",
      { permanent: true }
    );
  }
};

const plexHeaders = (
  attempt: Pick<PlexAuthAttempt, 'clientIdentifier' | 'product' | 'version' | 'platform'>
) => ({
  'X-Plex-Client-Identifier': attempt.clientIdentifier,
  'X-Plex-Product': attempt.product,
  'X-Plex-Version': attempt.version,
  'X-Plex-Platform': attempt.platform,
  Accept: 'application/json'
});

const responseJson = async (response: Response, context: string) => {
  try {
    return await response.json();
  } catch (error) {
    throw new PlexAuthError('provider', `${context} : réponse Plex invalide.`, { cause: error });
  }
};

const parseExpiryMs = (payload: any, createdAt: number) => {
  const explicitExpiry = payload?.expiresAt ?? payload?.expires_at;
  if (typeof explicitExpiry === 'number' && Number.isFinite(explicitExpiry)) {
    return explicitExpiry > 10_000_000_000 ? explicitExpiry : explicitExpiry * 1000;
  }
  if (typeof explicitExpiry === 'string') {
    const parsed = Date.parse(explicitExpiry);
    if (Number.isFinite(parsed)) return parsed;
  }

  const expiresIn = Number(payload?.expiresIn ?? payload?.expires_in);
  if (Number.isFinite(expiresIn) && expiresIn > 0) {
    return createdAt + expiresIn * 1000;
  }
  return createdAt + DEFAULT_PIN_TTL_MS;
};

const parseRetryAfterMs = (response: Response, now: number) => {
  const retryAfter = response.headers.get('retry-after');
  if (!retryAfter) return MIN_RETRY_AFTER_MS;

  const seconds = Number(retryAfter);
  const rawMs = Number.isFinite(seconds)
    ? seconds * 1000
    : Math.max(0, Date.parse(retryAfter) - now);
  if (!Number.isFinite(rawMs)) return MIN_RETRY_AFTER_MS;
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(MIN_RETRY_AFTER_MS, rawMs));
};

const cancelledError = () => new PlexAuthError(
  'cancelled',
  'Association Plex annulée.',
  { permanent: true }
);

const providerFetch = async (
  input: string,
  init: RequestInit,
  options: PlexRequestOptions,
  context: string
) => {
  if (options.signal?.aborted) throw cancelledError();
  try {
    return await (options.fetchImpl ?? fetch)(input, { ...init, signal: options.signal });
  } catch (error) {
    if (options.signal?.aborted || (error as any)?.name === 'AbortError') {
      throw cancelledError();
    }
    throw new PlexAuthError('network', `${context} : Plex est momentanément inaccessible.`, { cause: error });
  }
};

const throwForPollStatus = (response: Response, now: number) => {
  if (response.status === 429) {
    throw new PlexAuthError(
      'rate_limited',
      'Plex demande de ralentir les vérifications.',
      { retryAfterMs: parseRetryAfterMs(response, now) }
    );
  }
  if (response.status === 404 || response.status === 410) {
    throw new PlexAuthError('expired', 'La demande Plex a expiré. Réessayez.', { permanent: true });
  }
  if ([400, 401, 403, 422].includes(response.status)) {
    throw new PlexAuthError('refused', "Plex a refusé la demande d'association. Réessayez.", { permanent: true });
  }
  if (!response.ok) {
    throw new PlexAuthError('provider', `Plex a répondu avec le statut ${response.status}.`);
  }
};

export const buildPlexAuthUrl = (attempt: PlexAuthAttempt) => {
  assertAttemptIdentity(attempt);
  const params = new URLSearchParams();
  params.set('clientID', attempt.clientIdentifier);
  params.set('code', attempt.code);
  params.set('context[device][product]', attempt.product);
  params.set('context[device][version]', attempt.version);
  params.set('context[device][platform]', attempt.platform);
  return `${PLEX_AUTH_URL}#?${params.toString()}`;
};

export const getPlexPin = async (
  platform: PlexAuthPlatform = 'Web',
  options: PlexRequestOptions = {}
): Promise<PlexAuthAttempt> => {
  const clientIdentifier = getPlexClientId();
  const createdAt = (options.now ?? Date.now)();
  const identity = {
    clientIdentifier,
    product: PLEX_PRODUCT,
    version: PLEX_VERSION,
    platform
  } as const;

  const response = await providerFetch(
    `${PLEX_PIN_URL}?strong=true`,
    { method: 'POST', headers: plexHeaders(identity) },
    options,
    'Création du code Plex'
  );

  if (!response.ok) {
    const permanent = response.status >= 400 && response.status < 500 && response.status !== 429;
    throw new PlexAuthError('provider', "Plex a refusé la création de la demande d'association.", { permanent });
  }

  const payload = await responseJson(response, 'Création du code Plex');
  const pinId = Number(payload?.id);
  const code = typeof payload?.code === 'string' ? payload.code : '';
  if (!Number.isFinite(pinId) || pinId <= 0 || !code) {
    throw new PlexAuthError('provider', 'Plex a renvoyé une demande incomplète.');
  }
  if (payload?.clientIdentifier && payload.clientIdentifier !== clientIdentifier) {
    throw new PlexAuthError('identity_mismatch', "Plex a renvoyé une identité différente de la tentative.", { permanent: true });
  }

  return Object.freeze({
    pinId,
    code,
    ...identity,
    createdAt,
    expiresAt: parseExpiryMs(payload, createdAt)
  });
};

export const validatePlexToken = async (
  attempt: PlexAuthAttempt,
  token: string,
  options: PlexRequestOptions = {}
): Promise<PlexAccount> => {
  assertAttemptIdentity(attempt);
  if (!token) {
    throw new PlexAuthError('invalid_token', 'Plex a renvoyé un jeton vide.', { permanent: true });
  }

  const response = await providerFetch(
    PLEX_USER_URL,
    {
      method: 'GET',
      headers: { ...plexHeaders(attempt), 'X-Plex-Token': token }
    },
    options,
    'Validation du compte Plex'
  );

  if (response.status === 401 || response.status === 403) {
    throw new PlexAuthError('invalid_token', 'Le jeton Plex reçu est invalide.', { permanent: true });
  }
  if (!response.ok) {
    throw new PlexAuthError('provider', `Validation Plex impossible (${response.status}).`);
  }

  const account = await responseJson(response, 'Validation du compte Plex');
  return {
    username: typeof account?.username === 'string' ? account.username : undefined,
    title: typeof account?.title === 'string' ? account.title : undefined,
    email: typeof account?.email === 'string' ? account.email : undefined
  };
};

export const checkPlexPin = async (
  attempt: PlexAuthAttempt,
  options: PlexRequestOptions = {}
): Promise<PlexPinPollResult> => {
  assertAttemptIdentity(attempt);
  const now = (options.now ?? Date.now)();
  if (now >= attempt.expiresAt) {
    throw new PlexAuthError('expired', 'La demande Plex a expiré. Réessayez.', { permanent: true });
  }

  const response = await providerFetch(
    `${PLEX_PIN_URL}/${attempt.pinId}`,
    { method: 'GET', headers: plexHeaders(attempt) },
    options,
    'Vérification de la demande Plex'
  );
  throwForPollStatus(response, now);

  const payload = await responseJson(response, 'Vérification de la demande Plex');
  if (payload?.clientIdentifier && payload.clientIdentifier !== attempt.clientIdentifier) {
    throw new PlexAuthError('identity_mismatch', "L'identité Plex a changé pendant la tentative.", { permanent: true });
  }

  const authToken = typeof payload?.authToken === 'string' && payload.authToken.trim()
    ? payload.authToken.trim()
    : null;
  if (!authToken) {
    return { authToken: null, username: typeof payload?.username === 'string' ? payload.username : undefined };
  }

  const account = await validatePlexToken(attempt, authToken, options);
  return {
    authToken,
    username: account.username ?? account.title ?? (typeof payload?.username === 'string' ? payload.username : undefined),
    account
  };
};

const defaultDelay = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) {
    reject(cancelledError());
    return;
  }
  const timeout = setTimeout(() => {
    signal?.removeEventListener('abort', onAbort);
    resolve();
  }, ms);
  const onAbort = () => {
    clearTimeout(timeout);
    reject(cancelledError());
  };
  signal?.addEventListener('abort', onAbort, { once: true });
});

export const pollPlexAuthAttempt = async (
  attempt: PlexAuthAttempt,
  options: PlexPollOptions = {}
): Promise<PlexPinPollResult> => {
  assertAttemptIdentity(attempt);
  const now = options.now ?? Date.now;
  const delay = options.delay ?? defaultDelay;

  while (true) {
    if (options.signal?.aborted) throw cancelledError();
    const remainingMs = attempt.expiresAt - now();
    if (remainingMs <= 0) {
      throw new PlexAuthError('expired', 'La demande Plex a expiré. Réessayez.', { permanent: true });
    }

    try {
      const result = await checkPlexPin(attempt, options);
      if (result.authToken) return result;
      await delay(Math.min(DEFAULT_POLL_INTERVAL_MS, remainingMs), options.signal);
    } catch (error) {
      if (error instanceof PlexAuthError && error.code === 'rate_limited') {
        const retryAfterMs = Math.min(error.retryAfterMs ?? MIN_RETRY_AFTER_MS, remainingMs);
        await delay(retryAfterMs, options.signal);
        continue;
      }
      throw error;
    }
  }
};
