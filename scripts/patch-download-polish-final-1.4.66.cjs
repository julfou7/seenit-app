const fs = require('fs');

function replaceOnce(content, from, to, label) {
  if (!content.includes(from)) throw new Error(`Introuvable: ${label}`);
  return content.replace(from, to);
}

{
  const path = 'src/services/sonarrRadarr.ts';
  let s = fs.readFileSync(path, 'utf8');
  const helper = `    const ensureEpisodeMonitored = async (episode: any) => {\n      if (!episode?.id || episode.monitored === true) return;\n      await executePut(\`${'${base}'}/api/v3/episode/\${episode.id}\`, {\n        ...episode,\n        monitored: true\n      }, headers);\n    };\n`;
  const helperNew = `    const ensureEpisodeMonitored = async (episode: any) => {\n      if (!episode?.id || episode.monitored === true) return;\n      await executePut(\`${'${base}'}/api/v3/episode/\${episode.id}\`, {\n        ...episode,\n        monitored: true\n      }, headers);\n    };\n\n    const findEpisodeByNumber = async (\n      seriesId: number,\n      season: number,\n      episode: number,\n      attempts = 1\n    ): Promise<any | null> => {\n      for (let attempt = 0; attempt < attempts; attempt += 1) {\n        const episodes: any[] = await executeGet(\`${'${base}'}/api/v3/episode?seriesId=\${seriesId}\`, headers);\n        const target = Array.isArray(episodes)\n          ? episodes.find((ep: any) =>\n              Number(ep.seasonNumber) === Number(season) && Number(ep.episodeNumber) === Number(episode)\n            )\n          : null;\n        if (target) return target;\n        if (attempt < attempts - 1) {\n          await new Promise(resolve => setTimeout(resolve, 450 * (attempt + 1)));\n        }\n      }\n      return null;\n    };\n`;
  s = replaceOnce(s, helper, helperNew, 'helper recherche épisode');

  const existing = `          const episodes: any[] = await executeGet(\`${'${base}'}/api/v3/episode?seriesId=\${seriesId}\`, headers);\n          const targetEp = Array.isArray(episodes) ? episodes.find((ep: any) => \n            Number(ep.seasonNumber) === Number(params.season) && Number(ep.episodeNumber) === Number(params.episode)\n          ) : null;\n`;
  const existingNew = `          const targetEp = await findEpisodeByNumber(\n            Number(seriesId),\n            Number(params.season),\n            Number(params.episode),\n            1\n          );\n`;
  s = replaceOnce(s, existing, existingNew, 'recherche épisode série existante');

  const created = `          const episodes: any[] = await executeGet(\`${'${base}'}/api/v3/episode?seriesId=\${created.id}\`, headers);\n          const targetEp = Array.isArray(episodes) ? episodes.find((ep: any) => \n            Number(ep.seasonNumber) === Number(params.season) && Number(ep.episodeNumber) === Number(params.episode)\n          ) : null;\n`;
  const createdNew = `          const targetEp = await findEpisodeByNumber(\n            Number(created.id),\n            Number(params.season),\n            Number(params.episode),\n            4\n          );\n`;
  s = replaceOnce(s, created, createdNew, 'recherche épisode après ajout');
  fs.writeFileSync(path, s);
}

{
  const path = 'src/store/liveDownloadStore.ts';
  let s = fs.readFileSync(path, 'utf8');
  s = replaceOnce(s,
    `      const now = Date.now();\n      const remoteItems: LiveDownloadItem[] = [];\n`,
    `      const now = Date.now();\n      const removedRequestDocIds = new Set(\n        snapshot.docChanges()\n          .filter(change => change.type === 'removed')\n          .map(change => change.doc.id)\n      );\n      const remoteItems: LiveDownloadItem[] = [];\n`,
    'détection suppressions distantes');
  s = replaceOnce(s,
    `      if (!remoteItems.length) return;\n      useLiveDownloadStore.setState(state => {\n        const downloads = [...(state.downloads || [])];\n`,
    `      if (!remoteItems.length && removedRequestDocIds.size === 0) return;\n      useLiveDownloadStore.setState(state => {\n        const downloads = [...(state.downloads || [])].filter(item =>\n          !item.isOptimistic || !removedRequestDocIds.has(sharedRequestDocId(item))\n        );\n`,
    'application suppressions distantes');
  fs.writeFileSync(path, s);
}

console.log('Renfort final 1.4.66 appliqué.');
