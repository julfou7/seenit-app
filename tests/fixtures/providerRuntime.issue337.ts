import { create } from 'zustand';

export const auth = {
  currentUser: null as { uid: string } | null,
  onAuthStateChanged: (_listener: unknown) => () => {},
};
export const db = {};
export const telemetry = { requests: 0, requestIds: [] as number[], reads: 0, saves: [] as number[][], marks: [] as Array<{ id: string; season: number; episode: number }> };
export const results = { FR: { flatrate: [
  { provider_id: 8, provider_name: 'Netflix', logo_path: '/netflix.png' },
  { provider_id: 531, provider_name: 'Paramount Plus', logo_path: '/paramount.png' },
] } };
let finishNetwork: (value: Response) => void = () => {};
export const authenticatedFetch = async (input: RequestInfo | URL): Promise<Response> => {
  const url = String(input);
  if (!url.includes('/watch/providers')) throw new Error(`Appel inattendu dans la fixture : ${url}`);
  telemetry.requests++;
  telemetry.requestIds.push(Number(url.match(/(?:tv|movie)\/(\d+)\//)?.[1]));
  return new Promise<Response>(resolve => { finishNetwork = resolve; });
};
export const getAuthenticatedHeaders = async () => ({});
export const finishProviderNetwork = () => finishNetwork(new Response(JSON.stringify({ results }), { status: 200 }));

interface PlexCache {
  cache: Record<string, { available: boolean; serverName: string }>;
  getMediaAvailability: (key: string) => { available: boolean; serverName: string } | undefined;
}
export const usePlexAvailabilityStore = create<PlexCache>((_, get) => ({
  cache: {}, getMediaAvailability: key => get().cache[key],
}));
export const getPlexMediaKey = (id: number | string | null, type: string) => `v3:${auth.currentUser?.uid || 'anonymous'}:${type}:${id}`;
