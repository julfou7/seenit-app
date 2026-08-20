const fs = require('fs');
let code = fs.readFileSync('src/screens/ShowDetailScreen.tsx', 'utf-8');

// 1. Fix imdbData loading
code = code.replace(
  /getSeriesImdbData\(resolvedImdbId\)\.then\(\(data\) => {\s*if \(isMounted\) {\s*if \(data\) setImdbData\(data\);\s*setImdbLoading\(false\);\s*}\s*}\);/g,
  `getSeriesImdbData(resolvedImdbId).then((data) => {
      if (isMounted) {
        setImdbData(data || { rating: 0 });
        setImdbLoading(false);
      }
    }).catch(() => {
      if (isMounted) {
        setImdbData({ rating: 0 });
        setImdbLoading(false);
      }
    });`
);

// 2. Fix providers null
code = code.replace(
  /setProviders\(res\.value\.results\?\.FR \|\| null\);/g,
  `setProviders(res.value.results?.FR || []);`
);

// 3. Fix checkPlexAvailability failure to set not found
code = code.replace(
  /checkPlexAvailability\(\{[\s\S]*?\}\)\.then\(info => \{\s*if \(isMounted && info\.available\) \{\s*setPlexMediaInfo\(info\);\s*\}\s*\}\)\.catch\(\(\) => \{\}\);/g,
  `checkPlexAvailability({
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
    });`
);

fs.writeFileSync('src/screens/ShowDetailScreen.tsx', code);
