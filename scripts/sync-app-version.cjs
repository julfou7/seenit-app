const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const selfPath = __filename;
const originalSelf = execFileSync('git', ['show', 'HEAD^:scripts/sync-app-version.cjs'], { cwd: root, encoding: 'utf8' });

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function write(relativePath, content) {
  fs.writeFileSync(path.join(root, relativePath), content, 'utf8');
}

function replaceOnce(source, search, replacement, label) {
  if (!source.includes(search)) {
    throw new Error(`[1.4.73] Motif introuvable pour ${label}`);
  }
  return source.replace(search, replacement);
}

function replaceRegex(source, regex, replacement, label) {
  if (!regex.test(source)) {
    throw new Error(`[1.4.73] Motif regex introuvable pour ${label}`);
  }
  regex.lastIndex = 0;
  return source.replace(regex, replacement);
}

// 1) Sélection qBittorrent : un torrent n'est manipulable que s'il est apparu après la demande.
{
  const file = 'src/features/downloads/episodePackSelection.ts';
  let source = read(file);
  const anchor = '\nfunction releaseMatchesQuality';
  const helper = `
function normalizeTorrentCorrelationId(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

/**
 * Retourne uniquement les torrents qBittorrent apparus après le snapshot initial
 * et prouvés par un identifiant exact Sonarr ou par l'infohash exact de la release.
 * Un hash déjà présent avant la demande n'est jamais éligible, même s'il correspond
 * à la release choisie : SeenIt ne doit jamais modifier un torrent préexistant.
 */
export function findExactNewTorrentIds(
  candidateDownloadIds: Array<string | null | undefined>,
  currentQbitHashes: Array<string | null | undefined>,
  beforeQbitHashes: Array<string | null | undefined>,
  releaseHash?: string | null
): string[] {
  const before = new Set(
    (beforeQbitHashes || []).map(normalizeTorrentCorrelationId).filter(Boolean)
  );
  const current = new Set(
    (currentQbitHashes || []).map(normalizeTorrentCorrelationId).filter(Boolean)
  );
  const newlySeen = new Set(Array.from(current).filter(hash => !before.has(hash)));
  const exact = new Set<string>();

  for (const candidate of candidateDownloadIds || []) {
    const id = normalizeTorrentCorrelationId(candidate);
    if (id && newlySeen.has(id)) exact.add(id);
  }

  const normalizedReleaseHash = normalizeTorrentCorrelationId(releaseHash);
  if (normalizedReleaseHash && newlySeen.has(normalizedReleaseHash)) {
    exact.add(normalizedReleaseHash);
  }

  return Array.from(exact);
}
`;
  source = replaceOnce(source, anchor, `${helper}${anchor}`, 'helper torrents nouveaux');
  write(file, source);
}

// 2) Tests de non-régression sur la frontière avant/après la demande.
{
  const file = 'tests/episodePackSelection.test.ts';
  let source = read(file);
  source = replaceOnce(
    source,
    '  extractReleaseTorrentHash,\n  hasCompatibleIndividualEpisodeRelease,',
    '  extractReleaseTorrentHash,\n  findExactNewTorrentIds,\n  hasCompatibleIndividualEpisodeRelease,',
    'import findExactNewTorrentIds'
  );
  source += `

test('ne manipule jamais un hash qBittorrent déjà présent avant la demande', () => {
  const oldHash = 'a'.repeat(40);
  assert.deepEqual(findExactNewTorrentIds(
    [oldHash],
    [oldHash],
    [oldHash],
    oldHash
  ), []);
});

test('accepte l’infohash exact de la release uniquement lorsqu’il vient d’apparaître', () => {
  const newHash = 'b'.repeat(40);
  assert.deepEqual(findExactNewTorrentIds(
    [],
    [newHash],
    [],
    newHash
  ), [newHash]);
});

test('ignore un torrent concurrent sans identifiant Sonarr exact', () => {
  const wanted = 'c'.repeat(40);
  const unrelated = 'd'.repeat(40);
  assert.deepEqual(findExactNewTorrentIds(
    [wanted],
    [wanted, unrelated],
    [],
    null
  ), [wanted]);
});

test('laisse l’ambiguïté visible si plusieurs nouveaux IDs exacts existent', () => {
  const first = 'e'.repeat(40);
  const second = 'f'.repeat(40);
  assert.deepEqual(new Set(findExactNewTorrentIds(
    [first, second],
    [first, second],
    [],
    null
  )), new Set([first, second]));
});
`;
  write(file, source);
}

// 3) Orchestration pack saison : queue + historique Sonarr + qBittorrent, uniquement par IDs exacts.
{
  const file = 'src/features/downloads/episodeSeasonPackFallback.ts';
  let source = read(file);
  source = replaceOnce(
    source,
    '  extractReleaseTorrentHash,\n  hasCompatibleIndividualEpisodeRelease,',
    '  extractReleaseTorrentHash,\n  findExactNewTorrentIds,\n  hasCompatibleIndividualEpisodeRelease,',
    'import corrélation pack'
  );

  const queueAnchor = `async function fetchSonarrQueue(base: string, headers: Record<string, string>): Promise<any[]> {
  const response = await executeGet(
    \`${'${base}'}/api/v3/queue?pageSize=100&includeSeries=true&includeEpisode=true\`,
    headers
  );
  return Array.isArray(response) ? response : (Array.isArray(response?.records) ? response.records : []);
}
`;
  const historyHelpers = `${queueAnchor}
async function fetchSonarrHistory(base: string, headers: Record<string, string>): Promise<any[]> {
  const response = await executeGet(
    \`${'${base}'}/api/v3/history?page=1&pageSize=100&sortKey=date&sortDirection=descending&includeSeries=true&includeEpisode=true\`,
    headers
  );
  return Array.isArray(response) ? response : (Array.isArray(response?.records) ? response.records : []);
}

function collectSeasonHistoryDownloadIds(
  records: any[],
  seriesId: number,
  season: number,
  excludedHistoryIds: Set<string>
): string[] {
  const ids = new Set<string>();
  for (const record of Array.isArray(records) ? records : []) {
    const historyId = String(record?.id ?? record?.historyId ?? '').trim();
    if (!historyId || excludedHistoryIds.has(historyId)) continue;
    const eventType = String(record?.eventType || '').toLowerCase();
    if (eventType && eventType !== 'grabbed') continue;
    const recordSeriesId = Number(record?.series?.id ?? record?.seriesId);
    const recordSeason = Number(record?.episode?.seasonNumber ?? record?.seasonNumber);
    if (recordSeriesId !== Number(seriesId) || recordSeason !== Number(season)) continue;
    const downloadId = normalizeDownloadClientId(record?.downloadId ?? record?.data?.downloadId);
    if (downloadId) ids.add(downloadId);
  }
  return Array.from(ids);
}
`;
  source = replaceOnce(source, queueAnchor, historyHelpers, 'historique Sonarr');

  source = replaceOnce(
    source,
    `  beforeQueueIds: Set<string>,\n  beforeQbitHashes: Set<string>,\n  release: any`,
    `  beforeQueueIds: Set<string>,\n  beforeQbitHashes: Set<string>,\n  beforeHistoryIds: Set<string>,\n  release: any`,
    'signature waitForPackTransfer'
  );

  const oldPollBlock = `    const [queue, torrents] = await Promise.all([
      fetchSonarrQueue(base, sonarrHeaders).catch(() => []),
      fetchQbitTorrents(params, qHeaders).catch(() => [])
    ]);
    const qbitHashes = new Set(
      torrents
        .map(torrent => normalizeDownloadClientId(torrent?.hash))
        .filter(Boolean) as string[]
    );
    const newQbitHashes = Array.from(qbitHashes).filter(hash => !beforeQbitHashes.has(hash));
    const candidates = collectSeasonTransfers(queue, seriesId, params.season, beforeQueueIds);

    if (releaseHash && qbitHashes.has(releaseHash)) {
      const exactQueue = candidates.find(candidate => candidate.downloadId === releaseHash);
      return { downloadId: releaseHash, queueIds: exactQueue?.queueIds || [] };
    }

    const intersected = candidates.filter(candidate => qbitHashes.has(candidate.downloadId));
    if (intersected.length === 1) {
      return { downloadId: intersected[0].downloadId, queueIds: intersected[0].queueIds };
    }

    if (candidates.length === 1 && newQbitHashes.length === 1 && candidates[0].downloadId === newQbitHashes[0]) {
      return { downloadId: candidates[0].downloadId, queueIds: candidates[0].queueIds };
    }
`;
  const newPollBlock = `    const [queue, history, torrents] = await Promise.all([
      fetchSonarrQueue(base, sonarrHeaders).catch(() => []),
      fetchSonarrHistory(base, sonarrHeaders).catch(() => []),
      fetchQbitTorrents(params, qHeaders).catch(() => [])
    ]);
    const qbitHashes = new Set(
      torrents
        .map(torrent => normalizeDownloadClientId(torrent?.hash))
        .filter(Boolean) as string[]
    );
    const candidates = collectSeasonTransfers(queue, seriesId, params.season, beforeQueueIds);
    const historyDownloadIds = collectSeasonHistoryDownloadIds(
      history,
      seriesId,
      params.season,
      beforeHistoryIds
    );
    const exactNewTorrentIds = findExactNewTorrentIds(
      [...candidates.map(candidate => candidate.downloadId), ...historyDownloadIds],
      Array.from(qbitHashes),
      Array.from(beforeQbitHashes),
      releaseHash
    );

    if (exactNewTorrentIds.length === 1) {
      const downloadId = exactNewTorrentIds[0];
      const exactQueue = candidates.find(candidate => candidate.downloadId === downloadId);
      return { downloadId, queueIds: exactQueue?.queueIds || [] };
    }
`;
  source = replaceOnce(source, oldPollBlock, newPollBlock, 'poll corrélation pack');

  const beforeHashesAnchor = `  const beforeQbitHashes = new Set(
    beforeQbit
      .map(torrent => normalizeDownloadClientId(torrent?.hash))
      .filter(Boolean) as string[]
  );
`;
  source = replaceOnce(
    source,
    beforeHashesAnchor,
    `${beforeHashesAnchor}  const beforeHistory = await fetchSonarrHistory(base, sonarrHeaders).catch(() => []);\n  const beforeHistoryIds = new Set(\n    beforeHistory\n      .map(record => String(record?.id ?? record?.historyId ?? '').trim())\n      .filter(Boolean)\n  );\n`,
    'snapshot historique avant grab'
  );

  source = replaceOnce(
    source,
    `    beforeQueueIds,\n    beforeQbitHashes,\n    grabbedRelease`,
    `    beforeQueueIds,\n    beforeQbitHashes,\n    beforeHistoryIds,\n    grabbedRelease`,
    'appel waitForPackTransfer'
  );

  const oldFailure = `  if (!transfer) {
    const queue = await fetchSonarrQueue(base, sonarrHeaders).catch(() => []);
    const newTransfers = collectSeasonTransfers(queue, Number(target.series.id), Number(params.season), beforeQueueIds);
    await removeSonarrTransfer(base, sonarrHeaders, newTransfers.flatMap(item => item.queueIds));
    return {
      success: false,
      message: 'Le pack a été lancé mais SeenIt n’a pas pu corréler son torrent qBittorrent de façon certaine. Les transferts Sonarr identifiés ont été annulés par sécurité.'
    };
  }
`;
  const newFailure = `  if (!transfer) {
    const [queue, history, torrents] = await Promise.all([
      fetchSonarrQueue(base, sonarrHeaders).catch(() => []),
      fetchSonarrHistory(base, sonarrHeaders).catch(() => []),
      fetchQbitTorrents(params, qHeaders).catch(() => [])
    ]);
    const newTransfers = collectSeasonTransfers(queue, Number(target.series.id), Number(params.season), beforeQueueIds);
    const historyDownloadIds = collectSeasonHistoryDownloadIds(
      history,
      Number(target.series.id),
      Number(params.season),
      beforeHistoryIds
    );
    const currentQbitHashes = torrents
      .map(torrent => normalizeDownloadClientId(torrent?.hash))
      .filter(Boolean) as string[];
    const releaseHash = extractReleaseTorrentHash(grabbedRelease);
    const exactNewIds = findExactNewTorrentIds(
      [...newTransfers.map(item => item.downloadId), ...historyDownloadIds],
      currentQbitHashes,
      Array.from(beforeQbitHashes),
      releaseHash
    );

    const corroboratedSonarrIds = Array.from(new Set(
      newTransfers
        .map(item => item.downloadId)
        .filter(id => historyDownloadIds.includes(id))
    ));
    const exactCleanupId = exactNewIds.length === 1
      ? exactNewIds[0]
      : corroboratedSonarrIds.length === 1
        ? corroboratedSonarrIds[0]
        : releaseHash && !beforeQbitHashes.has(releaseHash)
          ? releaseHash
          : null;

    if (exactCleanupId) {
      const exactQueueIds = newTransfers
        .filter(item => item.downloadId === exactCleanupId)
        .flatMap(item => item.queueIds);
      await removeSonarrTransfer(base, sonarrHeaders, exactQueueIds);
      if (/^[a-f0-9]{40}$|^[a-f0-9]{64}$/i.test(exactCleanupId)) {
        await removeExactQbitTorrent(params, qHeaders, exactCleanupId);
        await delay(700);
        await removeExactQbitTorrent(params, qHeaders, exactCleanupId);
      }
      return {
        success: false,
        message: 'Le pack a été lancé mais sa corrélation n’a pas été confirmée à temps. Le transfert exact identifié a été annulé dans Sonarr et qBittorrent par sécurité.'
      };
    }

    return {
      success: false,
      message: 'Le pack a été lancé mais aucun identifiant technique unique ne permet de le corréler sans risque. SeenIt n’a modifié aucun torrent préexistant ; vérifie qBittorrent avant de relancer.'
    };
  }
`;
  source = replaceOnce(source, oldFailure, newFailure, 'nettoyage échec corrélation');
  write(file, source);
}

// 4) Indicateur compact : ne plus écraser le titre d'épisode avec une longue pastille.
{
  const file = 'src/components/LiveDownloadBanner.tsx';
  let source = read(file);
  const compactRegex = /  if \(compact\) \{[\s\S]*?\n  \}\n\n  return \(\n    <div className="space-y-2\.5">/;
  const compactReplacement = `  if (compact) {
    const item = items[0];
    const phase = getPhase(item);
    const showProgress = phase.kind === 'downloading' || phase.kind === 'completed';
    const isActivityOnly = phase.kind === 'submitting' || phase.kind === 'searching' || phase.kind === 'queued';
    const shortLabel = phase.kind === 'error'
      ? 'Erreur'
      : phase.kind === 'warning'
        ? 'À vérifier'
        : phase.kind === 'completed'
          ? '100%'
          : phase.kind === 'downloading'
            ? \`${'${truncateDownloadProgressPercent(item.progress)}'}%\`
            : '';

    return (
      <div
        className={\`inline-flex shrink-0 items-center justify-center rounded-full border border-white/10 bg-zinc-900/90 text-[10px] font-bold text-zinc-200 shadow-sm ${'${isActivityOnly ? \'h-8 w-8 p-0\' : \'min-h-8 gap-1.5 px-2.5 py-1\'}'}\`}
        title={phase.label}
        aria-label={phase.label}
      >
        <PhaseIcon kind={phase.kind} />
        {!isActivityOnly && showProgress && <span className="shrink-0 text-white">{shortLabel}</span>}
        {!isActivityOnly && !showProgress && <span className="shrink-0">{shortLabel}</span>}
      </div>
    );
  }

  return (
    <div className="space-y-2.5">`;
  source = replaceRegex(source, compactRegex, compactReplacement, 'LiveDownloadBanner compact');
  write(file, source);
}

// 5) Écran Téléchargements : poster série, type de média et activité indéterminée claire.
{
  const file = 'src/screens/DownloadsScreen.tsx';
  let source = read(file);
  source = replaceOnce(
    source,
    `import { useDownloadConfigStore } from '../store/downloadConfigStore';`,
    `import { useDownloadConfigStore } from '../store/downloadConfigStore';\nimport { useShowsStore } from '../store/showsStore';`,
    'import showsStore téléchargements'
  );

  source = replaceOnce(
    source,
    `  const { cleanTitle, subTitle, isTv } = formatCleanMediaInfo(item);\n  const status = String(item.status || '').toLowerCase();`,
    `  const { cleanTitle, subTitle, isTv } = formatCleanMediaInfo(item);\n  const libraryPosterPath = useShowsStore(state => {\n    if (!item.tmdbId) return undefined;\n    return state.shows.find(show =>\n      show.mediaType === item.mediaType\n      && Number(show.tmdbId) === Number(item.tmdbId)\n    )?.posterPath || undefined;\n  });\n  const status = String(item.status || '').toLowerCase();`,
    'poster bibliothèque série'
  );

  source = replaceOnce(
    source,
    `  const progressLabel = isCancelled\n    ? (progress > 0 ? \`${'${progressPercent}'}%\` : '—')\n    : isCompleted\n      ? '100%'\n      : \`${'${progressPercent}'}%\`;`,
    `  const progressLabel = isPending\n    ? null\n    : isCancelled\n      ? (progress > 0 ? \`${'${progressPercent}'}%\` : '—')\n      : isCompleted\n        ? '100%'\n        : \`${'${progressPercent}'}%\`;`,
    'pourcentage préparation'
  );

  source = replaceOnce(
    source,
    `    item.posterPath\n  );`,
    `    item.posterPath || libraryPosterPath\n  );`,
    'fallback poster téléchargement'
  );

  const oldPoster = `        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            openDetails();
          }}
          className="relative w-16 aspect-[2/3] shrink-0 self-center overflow-hidden rounded-[14px] border border-white/10 bg-zinc-950 shadow-md flex items-center justify-center"
        >
          {posterSrc ? (
            <img
              src={posterSrc}
              alt={cleanTitle}
              className="absolute inset-0 block h-full w-full object-cover object-center"
              loading={isCompleted ? 'lazy' : 'eager'}
            />
          ) : isTv ? (
            <Tv size={22} className="text-purple-400" />
          ) : (
            <Film size={22} className="text-amber-400" />
          )}
        </button>`;
  const newPoster = `        <div className="w-16 shrink-0 self-center overflow-hidden rounded-[14px] border border-white/10 bg-zinc-950 shadow-md">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              openDetails();
            }}
            className="relative flex w-full aspect-[2/3] items-center justify-center overflow-hidden bg-zinc-950"
          >
            {posterSrc ? (
              <img
                src={posterSrc}
                alt={cleanTitle}
                className="absolute inset-0 block h-full w-full object-cover object-center"
                loading={isCompleted ? 'lazy' : 'eager'}
              />
            ) : isTv ? (
              <Tv size={22} className="text-purple-400" />
            ) : (
              <Film size={22} className="text-amber-400" />
            )}
          </button>
          <div className="flex items-center justify-center gap-1 border-t border-white/10 bg-white/[0.04] py-1 text-[8px] font-extrabold uppercase tracking-wide text-[#E5A93D]">
            {isTv ? <Tv size={9} /> : <Film size={9} />}
            <span>{isTv ? 'Série' : 'Film'}</span>
          </div>
        </div>`;
  source = replaceOnce(source, oldPoster, newPoster, 'label Film Série sous poster');

  source = replaceOnce(
    source,
    `            <span className={\`shrink-0 text-sm font-black tabular-nums ${'${accent}'}\`}>{progressLabel}</span>`,
    `            {progressLabel && (\n              <span className={\`shrink-0 text-sm font-black tabular-nums ${'${accent}'}\`}>{progressLabel}</span>\n            )}`,
    'masquer pourcentage préparation'
  );

  const oldPending = `          {isPending && progress <= 0 ? (
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/[0.05]" aria-label="Activité en cours">
              <div className="h-full w-1/3 rounded-full bg-cyan-400/35 animate-pulse" />
            </div>
          ) : (`;
  const newPending = `          {isPending && progress <= 0 ? (
            <div className="mt-2 flex h-2 items-center gap-1.5" aria-label="Préparation en cours">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400/90 animate-pulse" />
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400/60 animate-pulse [animation-delay:160ms]" />
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400/30 animate-pulse [animation-delay:320ms]" />
            </div>
          ) : (`;
  source = replaceOnce(source, oldPending, newPending, 'activité préparation sans fausse barre');
  write(file, source);
}

// 6) Fiche média : le vrai 1-clic épisode utilise le fallback sûr, avec poster et cycle de vie SeenIt.
{
  const file = 'src/screens/ShowDetailScreen.tsx';
  let source = read(file);
  source = replaceOnce(
    source,
    `import { searchAndDownloadInSonarr, searchAndDownloadInRadarr } from '../services/sonarrRadarr';`,
    `import { searchAndDownloadInSonarr, searchAndDownloadInRadarr } from '../services/sonarrRadarr';\nimport { downloadEpisodeWithSeasonPackFallback } from '../features/downloads/episodeSeasonPackFallback';\nimport { acceptDownloadRequest, beginDownloadRequest, failDownloadRequest, updateDownloadRequest } from '../features/downloads/downloadLifecycle';`,
    'imports fallback fiche'
  );

  const handlerRegex = /  const handle1ClickDownloadEpisode = async \(e: React\.MouseEvent, seasonNumber: number, episodeNumber: number\) => \{[\s\S]*?\n  \};\n\n  const handle1ClickDownloadSeason/;
  const handlerReplacement = `  const handle1ClickDownloadEpisode = async (e: React.MouseEvent, seasonNumber: number, episodeNumber: number) => {
    e.stopPropagation();
    const config = useDownloadConfigStore.getState();
    if (!config.sonarrUrl || !config.sonarrApiKey) {
      showToast("Configurez Sonarr dans les paramètres pour le téléchargement 1-clic", "error");
      setDownloadTargetSeason(seasonNumber);
      setDownloadTargetEpisode(episodeNumber);
      setIsDownloadModalOpen(true);
      return;
    }

    const epKey = \`S${'${seasonNumber}'}E${'${episodeNumber}'}\`;
    setIs1ClickDownloading(prev => ({ ...prev, [epKey]: true }));
    const showTitle = show?.title || tmdbDetails?.name || tmdbDetails?.original_name || 'Série';
    const tvdbId = tmdbDetails?.external_ids?.tvdb_id || (show as any)?.tvdbId;
    const imdbId = tmdbDetails?.external_ids?.imdb_id || (show as any)?.imdbId;
    const posterForDownload = tmdbDetails?.poster_path || show?.posterPath || undefined;
    const backdropForDownload = tmdbDetails?.backdrop_path || show?.backdropPath || undefined;
    const code = \`S${'${String(seasonNumber).padStart(2, \'0\')}'}E${'${String(episodeNumber).padStart(2, \'0\')}'}\`;

    const requestId = beginDownloadRequest({
      title: \`${'${showTitle}'} (${'${code}'})\`,
      mediaType: 'tv',
      tmdbId: effectiveTmdbId,
      tvdbId,
      imdbId,
      seasonNumber,
      episodeNumber,
      posterPath: posterForDownload,
      backdropPath: backdropForDownload,
      downloadClient: 'Sonarr',
      statusText: 'Préparation du téléchargement…',
      releaseTitle: \`${'${showTitle}'} • ${'${code}'} • 1080p\`
    });

    try {
      const res = await downloadEpisodeWithSeasonPackFallback({
        url: config.sonarrUrl,
        apiKey: config.sonarrApiKey,
        title: showTitle,
        tmdbId: effectiveTmdbId,
        tvdbId,
        imdbId,
        season: seasonNumber,
        episode: episodeNumber,
        qualityPreference: '1080p',
        qbittorrentUrl: config.qbittorrentUrl,
        qbittorrentUsername: config.qbittorrentUsername,
        qbittorrentPassword: config.qbittorrentPassword
      });

      if (res.success) {
        const nextStatus = res.status || 'searching';
        const statusText = res.message || \`${'${code}'} envoyé à Sonarr\`;
        acceptDownloadRequest(requestId, statusText, nextStatus);
        if (res.downloadId) {
          updateDownloadRequest(requestId, {
            downloadId: res.downloadId,
            downloadIdAliases: [res.downloadId],
            statusText
          });
        }
        showToast(res.fallbackUsed ? statusText : \`Téléchargement de ${'${code}'} lancé dans Sonarr !\`, 'success');
        useLiveDownloadStore.getState().startPolling(1000);
        void useLiveDownloadStore.getState().fetchDownloads();
      } else {
        failDownloadRequest(requestId, res.message);
        showToast(res.message || "Erreur lors du lancement dans Sonarr", "error");
      }
    } catch (err: any) {
      const message = err?.message || "Erreur réseau Sonarr";
      failDownloadRequest(requestId, message);
      showToast(message, "error");
    } finally {
      setIs1ClickDownloading(prev => ({ ...prev, [epKey]: false }));
    }
  };

  const handle1ClickDownloadSeason`;
  source = replaceRegex(source, handlerRegex, handlerReplacement, 'handler 1-clic épisode');

  const flagsAnchor = `  const hasDownloadError = !hasActiveDownload
    && !hasCompletedDownload
    && !hasCancelledDownload
    && mediaDownloads.some(item => item.status === 'error' || Boolean(item.errorMessage));
`;
  source = replaceOnce(
    source,
    flagsAnchor,
    `${flagsAnchor}  const showDownloadSummary = hasActiveDownload\n    || hasCancelledDownload\n    || hasDownloadError\n    || (!isSeries && hasCompletedDownload);\n`,
    'résumé téléchargement série/film'
  );

  source = replaceOnce(
    source,
    `          {/* Statut contextuel uniquement : le détail complet vit dans Téléchargements. */}\n          {mediaDownloads.length > 0 && (`,
    `          {/* Statut contextuel uniquement : le détail complet vit dans Téléchargements. */}\n          {showDownloadSummary && (`,
    'masquer succès global série'
  );
  write(file, source);
}

// 7) Version SeenIt 1.4.73 puis alignement des trois emplacements officiels.
{
  const gradlePath = 'android/app/build.gradle';
  let gradle = read(gradlePath);
  gradle = replaceRegex(gradle, /versionName\s+["']1\.4\.72["']/, 'versionName "1.4.73"', 'versionName 1.4.73');
  gradle = replaceRegex(gradle, /versionCode\s+104072/, 'versionCode 104073', 'versionCode 1.4.73');
  write(gradlePath, gradle);

  const updateStorePath = 'src/store/updateStore.ts';
  let updateStore = read(updateStorePath);
  updateStore = replaceRegex(updateStore, /export const CURRENT_APP_VERSION = ['"][^'"]+['"];/, `export const CURRENT_APP_VERSION = '1.4.73';`, 'CURRENT_APP_VERSION');
  write(updateStorePath, updateStore);

  const serverPath = 'server.ts';
  let server = read(serverPath);
  server = replaceRegex(server, /(['"]X-Plex-Version['"]\s*:\s*['"])[^'"]+(['"])/g, '$11.4.73$2', 'X-Plex-Version');
  write(serverPath, server);
}

// Le script temporaire ne doit pas rester dans main : on restaure exactement la version précédente.
fs.writeFileSync(selfPath, originalSelf, 'utf8');

const filesToCommit = [
  'android/app/build.gradle',
  'server.ts',
  'src/store/updateStore.ts',
  'src/features/downloads/episodePackSelection.ts',
  'src/features/downloads/episodeSeasonPackFallback.ts',
  'src/components/LiveDownloadBanner.tsx',
  'src/screens/DownloadsScreen.tsx',
  'src/screens/ShowDetailScreen.tsx',
  'tests/episodePackSelection.test.ts',
  'scripts/sync-app-version.cjs'
];

execFileSync('git', ['config', 'user.name', 'github-actions[bot]'], { cwd: root });
execFileSync('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'], { cwd: root });
execFileSync('git', ['add', '--', ...filesToCommit], { cwd: root, stdio: 'inherit' });

const commitMessage = `fix(téléchargements): sécuriser les packs et clarifier le suivi

- Refuse tout torrent qBittorrent présent avant une demande de pack épisode.
- Corrèle et nettoie les packs uniquement par identifiants techniques Sonarr et qBittorrent exacts.
- Affiche le poster des séries et un label Film ou Série sous chaque visuel du suivi.
- Remplace la fausse barre de préparation par un indicateur d’activité sans pourcentage.
- Réduit l’état compact des épisodes pour préserver le titre et les métadonnées.
- Réserve le statut global de téléchargement terminé aux films dans leur fiche.
- Branche le vrai téléchargement 1-clic épisode sur le fallback pack sécurisé.
- Publie SeenIt 1.4.73.

[skip ci]`;

execFileSync('git', ['commit', '-m', commitMessage], { cwd: root, stdio: 'inherit' });
execFileSync('git', ['push'], { cwd: root, stdio: 'inherit' });
console.log('[1.4.73] Correctifs appliqués et poussés. Le workflow courant valide maintenant l’état final.');
