const fs = require('fs');
let code = fs.readFileSync('src/screens/ShowDetailScreen.tsx', 'utf-8');

const oldEffect = `    tmdb.getWatchProviders(effectiveTmdbId, targetMediaType).then(res => {
      if (res.ok && isMounted) { 
        setProviders(res.value.results?.FR || []);
      }
    });

    checkPlexAvailability({
      tmdbId: effectiveTmdbId,
      title: show?.title || title,
      originalTitle: (show as any)?.originalTitle || (show as any)?.original_title,
      year: (show?.firstAirDate)?.slice(0, 4),
      mediaType: targetMediaType === 'tv' ? 'tv' : 'movie'
    }).then(info => {
      if (isMounted) {
        setPlexMediaInfo(info);
      }
    }).catch(() => {
      if (isMounted) {
        setPlexMediaInfo({ available: false });
      }
    });`;

const newEffect = `    tmdb.getWatchProviders(effectiveTmdbId, targetMediaType).then(res => {
      if (res.ok && isMounted) { 
        setProviders(res.value.results?.FR || []);
      }
    });

    // Check plex based on what we have initially, but if show title is unknown, we will retry in fetchDetails
    if (show?.title && show.title !== 'Chargement...') {
      checkPlexAvailability({
        tmdbId: effectiveTmdbId,
        title: show.title,
        originalTitle: (show as any)?.originalTitle || (show as any)?.original_title,
        year: (show?.firstAirDate)?.slice(0, 4),
        mediaType: targetMediaType === 'tv' ? 'tv' : 'movie'
      }).then(info => {
        if (isMounted) setPlexMediaInfo(info);
      }).catch(() => {
        if (isMounted) setPlexMediaInfo({ available: false });
      });
    }`;

code = code.replace(oldEffect, newEffect);

const fetchDetailsOld = `      if (res.ok) {
        setTmdbDetails(res.value);
        setFetchError(false);
        
        tmdb.getFranchiseTimeline(res.value).then(sagaParts => {
          if (sagaParts && sagaParts.length > 0 && isMounted) {
            setCollectionData({ parts: sagaParts });
          }
        });
      } else {`;

const fetchDetailsNew = `      if (res.ok) {
        setTmdbDetails(res.value);
        setFetchError(false);
        
        // If we didn't have the show title initially, check Plex now with the real title
        if (!show?.title || show.title === 'Chargement...') {
          checkPlexAvailability({
            tmdbId: effectiveTmdbId,
            title: res.value.name || res.value.title || 'Inconnu',
            originalTitle: res.value.original_name || res.value.original_title,
            year: res.value.first_air_date?.slice(0, 4) || res.value.release_date?.slice(0, 4),
            mediaType: targetMediaType === 'tv' ? 'tv' : 'movie'
          }).then(info => {
            if (isMounted) setPlexMediaInfo(info);
          }).catch(() => {
            if (isMounted) setPlexMediaInfo({ available: false });
          });
        }
        
        tmdb.getFranchiseTimeline(res.value).then(sagaParts => {
          if (sagaParts && sagaParts.length > 0 && isMounted) {
            setCollectionData({ parts: sagaParts });
          }
        });
      } else {`;

code = code.replace(fetchDetailsOld, fetchDetailsNew);

fs.writeFileSync('src/screens/ShowDetailScreen.tsx', code);
console.log('Fixed Plex Search logic');
