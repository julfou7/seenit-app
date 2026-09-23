import { enrichCinemaEvidenceForSearchResults } from '../discover/cinemaSearchEvidence';
import { tmdb as coreTmdb } from './tmdbCore';

const originalSmartSearchMulti = coreTmdb.smartSearchMulti.bind(coreTmdb);

coreTmdb.smartSearchMulti = (async (...args: Parameters<typeof originalSmartSearchMulti>) => {
  const result = await originalSmartSearchMulti(...args);
  if (!result.ok || !Array.isArray(result.value?.results)) return result;

  const results = await enrichCinemaEvidenceForSearchResults(result.value.results);
  return {
    ...result,
    value: {
      ...result.value,
      results,
    },
  };
}) as typeof coreTmdb.smartSearchMulti;

export const tmdb = coreTmdb;
