import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { downloadGroup } from '../src/features/downloads/downloadGroups.ts';
import type { LiveDownloadItem } from '../src/services/sonarrRadarrLive.ts';

// Décision du 15/11 (« Angel and the Badman ») : à la fin du transfert, « Téléchargé · import Plex en cours »
// est plus parlant que « Transfert terminé · import à confirmer ». Pas de nouvelle catégorie : la carte reste
// dans « En cours » et ne rejoint « Téléchargés » qu'une fois l'import confirmé.
test('fin de transfert : « Téléchargé · import Plex en cours », la carte reste dans En cours', () => {
  for (const file of ['src/components/DownloadItemCard.tsx', 'src/components/SeasonDownloadCard.tsx', 'src/store/liveDownloadStoreCore.ts']) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /Téléchargé · import Plex en cours/, file);
    assert.doesNotMatch(source, /import à confirmer/, file);
  }
  const importing = { status: 'importing', progress: 100, importState: 'pending' } as unknown as LiveDownloadItem;
  assert.equal(downloadGroup(importing), 'active', 'import en cours : toujours dans « En cours »');
  assert.equal(downloadGroup({ status: 'completed', progress: 100 } as LiveDownloadItem), 'completed', 'import confirmé : rejoint les terminés');
});
