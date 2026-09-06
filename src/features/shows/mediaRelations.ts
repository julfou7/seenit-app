export type RelationMediaType = 'movie' | 'tv';
export type MediaKey = `${RelationMediaType}:${number}`;
export type RelationKind = 'saga' | 'universe';

export interface MediaRelationMember {
  mediaKey: MediaKey;
  mediaType: RelationMediaType;
  tmdbId: number;
  label: string;
  releaseDate: string;
  posterPath: string | null;
}

export interface MediaRelationGroup {
  groupId: string;
  relationKind: RelationKind;
  source: 'seenit-manifest';
  sourceGroupId: string;
  version: number;
  members: readonly MediaRelationMember[];
}

export interface MediaRelationSnapshot {
  collection: any[];
  universe: any[];
}

const member = (
  mediaKey: MediaKey,
  label: string,
  releaseDate: string,
  posterPath: string | null,
): MediaRelationMember => {
  const [mediaType, rawId] = mediaKey.split(':') as [RelationMediaType, string];
  return { mediaKey, mediaType, tmdbId: Number(rawId), label, releaseDate, posterPath };
};

const group = (
  groupId: string,
  relationKind: RelationKind,
  members: MediaRelationMember[],
): MediaRelationGroup => ({
  groupId,
  relationKind,
  source: 'seenit-manifest',
  sourceGroupId: groupId,
  version: 1,
  members: [...members].sort((a, b) => a.releaseDate.localeCompare(b.releaseDate)),
});

/**
 * Manifeste volontairement explicite : chaque membre a été validé via son couple
 * type + ID TMDB. Une franchise absente est masquée, jamais devinée par son titre.
 */
export const MEDIA_RELATION_GROUPS: readonly MediaRelationGroup[] = [
  group('yellowstone-television-universe', 'universe', [
    member('tv:73586', 'Yellowstone', '2018-06-20', '/peNC0eyc3TQJa6x4TdKcBPNP4t0.jpg'),
    member('tv:118357', '1883', '2021-12-19', '/3VSB4OPwPBs6TJPwx0nZqlaEdsz.jpg'),
    member('tv:157744', '1923', '2022-12-18', '/3LsJXaOXmG2S972apBicb2QRiOS.jpg'),
    member('tv:157732', "Lawmen: L'histoire de Bass Reeves", '2023-11-05', '/s59RO5UUZXayUODKeLW4QcyaEsS.jpg'),
    member('tv:290856', 'Marshals: A Yellowstone Story', '2026-03-01', '/jPOKjzCG8tgUigtWyA4ME9fNeia.jpg'),
    member('tv:299167', 'Dutton Ranch', '2026-05-15', '/kaWNHypRh9OFSJzEgj8prvMkA5h.jpg'),
  ]),
  group('breaking-bad-universe', 'universe', [
    member('tv:1396', 'Breaking Bad', '2008-01-20', '/hVVxgGZFR3JaXmkstnG1IR9Qbt6.jpg'),
    member('tv:60059', 'Better Call Saul', '2015-02-08', '/7KyuCBjxsr4sNQga16DcN9ccEyf.jpg'),
    member('movie:559969', 'El Camino : Un film Breaking Bad', '2019-10-11', '/vGmDs7qGOgST23o9hKwiyGd6WeW.jpg'),
  ]),
  group('wizarding-world', 'universe', [
    member('movie:671', "Harry Potter à l'école des sorciers", '2001-11-16', '/fbxQ44VRdM2PVzHSNajUseUteem.jpg'),
    member('movie:672', 'Harry Potter et la Chambre des secrets', '2002-11-13', '/8KpHRokGpiaqEGpjYe0rpywtvUx.jpg'),
    member('movie:673', "Harry Potter et le Prisonnier d'Azkaban", '2004-05-31', '/t4P2079IyK19njHDP2GwQrKdvzd.jpg'),
    member('movie:674', 'Harry Potter et la Coupe de feu', '2005-11-16', '/hBak1pn5pbI4ycAbrgMMn1YI7P1.jpg'),
    member('movie:675', "Harry Potter et l'Ordre du Phénix", '2007-07-08', '/9ZfpCVNx0y8jpColnnfdA1HI4Zb.jpg'),
    member('movie:767', 'Harry Potter et le Prince de sang-mêlé', '2009-07-15', '/A4WWOzWUASfUeESXxduQxVmoD7t.jpg'),
    member('movie:12444', 'Harry Potter et les Reliques de la Mort - 1ère partie', '2010-11-17', '/yJm61MmTMjOmNXxPxdoaIkdqnOm.jpg'),
    member('movie:12445', 'Harry Potter et les Reliques de la Mort - 2ème partie', '2011-07-12', '/alQOPmKEPHkH4BLMEla1vTNYrUr.jpg'),
    member('movie:259316', 'Les Animaux Fantastiques', '2016-11-16', '/7641iyvTdREC0eO2YUPmIk4PtrO.jpg'),
    member('movie:338952', 'Les Animaux Fantastiques : Les Crimes de Grindelwald', '2018-11-14', '/aU1AKE8tTkZouGNImmArvfP5smR.jpg'),
    member('movie:338953', 'Les Animaux fantastiques : Les Secrets de Dumbledore', '2022-04-06', '/gzvSMS4MqBg2ThgGOS2YkNkoebf.jpg'),
    member('tv:224377', 'Harry Potter', '2026-12-25', '/4NqpRFYM63YrBhWhdQC1rIM3836.jpg'),
  ]),
  group('marvel-cinematic-universe', 'universe', [
    member('movie:1726', 'Iron Man', '2008-04-30', '/kNKUCNLu1lZDGAHOBEHxR6psYHx.jpg'),
    member('movie:1724', "L'Incroyable Hulk", '2008-06-12', '/cImKVGUiEnwLsNUyoMA0a0na2y5.jpg'),
    member('movie:10138', 'Iron Man 2', '2010-04-28', '/g9DSeSozGi4zpUyeOYZYMNmIv9O.jpg'),
    member('movie:10195', 'Thor', '2011-04-21', '/q8pF6s9b9veTQvxTqMDIQf9nJKi.jpg'),
    member('movie:1771', 'Captain America : First Avenger', '2011-07-22', '/l1SP3gyHA5ZEuf72WKx5ihtZZFO.jpg'),
    member('movie:24428', 'Avengers', '2012-04-25', '/ylsAO88v2tF0iXRFojPa0UaAJf1.jpg'),
    member('movie:68721', 'Iron Man 3', '2013-04-18', '/sE71EBrRMfW0NKMHlXPO55Km88X.jpg'),
    member('movie:76338', 'Thor : Le Monde des ténèbres', '2013-10-30', '/eAIGX0nlwlb5sMb4uDRGNFqMyG9.jpg'),
    member('movie:100402', "Captain America : Le Soldat de l'hiver", '2014-03-20', '/n3Xa8g1sWrUVUal6zk0OoC9ARo1.jpg'),
    member('movie:118340', 'Les Gardiens de la Galaxie', '2014-07-30', '/9a6fGeSV5kffyNPPMWCPhLOhLdJ.jpg'),
    member('movie:99861', "Avengers : L'Ère d'Ultron", '2015-04-22', '/A0tw88n1byyR2vodhJMlFPQGQgF.jpg'),
    member('movie:102899', 'Ant-Man', '2015-07-14', '/hAH2Rt2WvfMBK2tZDLMNuUTUwxG.jpg'),
    member('movie:271110', 'Captain America : Civil War', '2016-04-27', '/i2nc9IAP1xRWoa3MgeR7ldsshkV.jpg'),
    member('movie:284052', 'Doctor Strange', '2016-10-25', '/7wZ7mx7tY5SgflQKuJmQvwu3wGm.jpg'),
    member('movie:283995', 'Les Gardiens de la Galaxie Vol. 2', '2017-04-25', '/brgkPEPQJNGLuKRy8omRTcDfDuL.jpg'),
    member('movie:315635', 'Spider-Man : Homecoming', '2017-07-05', '/wFNNv1ZHglNdXJLYiEgpLY5sa9S.jpg'),
    member('movie:284053', 'Thor : Ragnarok', '2017-10-02', '/mAA8RXkgF87jSWWMSf6hgLl73mk.jpg'),
    member('movie:284054', 'Black Panther', '2018-02-13', '/g94IcdzPswTYl1ISdgn2EwvaZtt.jpg'),
    member('movie:299536', 'Avengers : Infinity War', '2018-04-25', '/hSfuKPtyEryeFzapZ8UgZd4aESu.jpg'),
    member('movie:363088', 'Ant-Man et la Guêpe', '2018-07-04', '/r3Vapr4sdXOhHBThTNtfuijKe5V.jpg'),
    member('movie:299537', 'Captain Marvel', '2019-03-06', '/aRJAoQ6mqPHAKXjP3CqNyLC8FAh.jpg'),
    member('movie:299534', 'Avengers : Endgame', '2019-04-24', '/wF7jv3x51hXgkl7t5KHePuRjXc8.jpg'),
    member('movie:429617', 'Spider-Man : Far From Home', '2019-06-28', '/9FkewgPxlMPjgKhFN7LaRJEqmCI.jpg'),
    member('tv:85271', 'WandaVision', '2021-01-15', '/AXnCR7WE8BKlzsabQtUITySChn.jpg'),
    member('tv:88396', 'Falcon et le Soldat de l’hiver', '2021-03-19', '/6NrUwEWDxZI2XffOnw3nuibukmX.jpg'),
    member('tv:84958', 'Loki', '2021-06-09', '/zNwEwSXojMrQapZHQx5fO8iph4R.jpg'),
    member('movie:497698', 'Black Widow', '2021-07-07', '/tIdq9lGrbSsq3RkgB9r0g0vYTbl.jpg'),
    member('tv:91363', 'What If...?', '2021-08-11', '/mj98hl3XsRcxYdw99arNavsSBDP.jpg'),
    member('movie:566525', 'Shang-Chi et la Légende des Dix Anneaux', '2021-09-01', '/g54eUtuCTAOQaNlVpr7Kpr7sVoH.jpg'),
    member('movie:524434', 'Les Éternels', '2021-11-03', '/vV7TrS7PNRZJHCxNmiYN1SU7s1w.jpg'),
    member('tv:88329', 'Hawkeye', '2021-11-24', '/cybZ7FoeBoBJPieKvSp4wh2yCMR.jpg'),
    member('movie:634649', 'Spider-Man : No Way Home', '2021-12-15', '/jwfDFqzxBkXC5bERBZrCEfK9iii.jpg'),
    member('tv:92749', 'Moon Knight', '2022-03-30', '/xrkDlkL6u26DLeBw2Cao8pYtrYH.jpg'),
    member('movie:453395', 'Doctor Strange in the Multiverse of Madness', '2022-05-04', '/arfzjn1tGvXWwkX7eaGVuXsc0mp.jpg'),
    member('tv:92782', 'Miss Marvel', '2022-06-08', '/3x1eRyuz2NOOSXODDcDl9EjGRQ.jpg'),
    member('movie:616037', 'Thor : Love and Thunder', '2022-07-06', '/kSMarEm3ESOOr11dzsep2RZ1ClD.jpg'),
    member('tv:92783', 'She-Hulk : Avocate', '2022-08-18', '/poWy1hDzaIFv6UaYtFDNcNfiM2C.jpg'),
    member('movie:894205', 'Werewolf by Night', '2022-09-25', '/5p6Q5dsqgT7dknImjtoRvNx50k9.jpg'),
    member('movie:505642', 'Black Panther : Wakanda Forever', '2022-11-09', '/rNTKgJdJ8tyfpiUug5ittECK8CS.jpg'),
    member('movie:774752', 'Les Gardiens de la Galaxie : Joyeuses Fêtes', '2022-11-24', '/cF3E6CrCm3NUy5PDRBbGyXRChYb.jpg'),
    member('movie:640146', 'Ant-Man et la Guêpe : Quantumania', '2023-02-15', '/2hq8EKF6kaUyOxB9KhmIb5JUxEe.jpg'),
    member('movie:447365', 'Les Gardiens de la Galaxie : Volume 3', '2023-05-03', '/dnyQnKSSqQ8aOEMiE5hYDNJO4dE.jpg'),
    member('tv:114472', 'Secret Invasion', '2023-06-21', '/AbqvJTbFEOmL8vHk54lVolqQg8Y.jpg'),
    member('movie:609681', 'The Marvels', '2023-11-08', '/mqAQO6j5gkq6iwCXNbXpzf0RXBU.jpg'),
    member('tv:122226', 'Echo', '2024-01-09', '/g7Y8pX0yndEpGAa0v4ZGpGuMrF0.jpg'),
    member('movie:533535', 'Deadpool & Wolverine', '2024-07-24', '/7CtRdKd5hQPB2b1apKCqxxQUKSf.jpg'),
    member('tv:138501', 'Agatha All Along', '2024-09-18', '/mGsxKwXUjojitRv2E9qMTbxbBRd.jpg'),
    member('movie:822119', 'Captain America : Brave New World', '2025-02-12', '/wDRXmiAEJdhNIcuetM4016fOCx8.jpg'),
    member('tv:202555', 'Daredevil : Born Again', '2025-03-04', '/7UMmvMvhSw1jBgdz0NzLo9pa93g.jpg'),
    member('movie:986056', 'Thunderbolts*', '2025-04-30', '/zctISSBEZRgVQPG178HqRJMnc4x.jpg'),
    member('tv:114471', 'Ironheart', '2025-06-24', '/dtpiECNwAeLnGJSU3HTWhcQGHk1.jpg'),
    member('movie:617126', 'Les 4 Fantastiques : Premiers Pas', '2025-07-23', '/rNc4KARs6fVa4axzvuv3NfUiNy1.jpg'),
    member('tv:198178', 'Wonder Man', '2026-01-27', '/5uHI0TCde9YDGY7Fm54L3mBNILK.jpg'),
  ]),
  group('the-dark-knight-trilogy', 'saga', [
    member('movie:272', 'Batman Begins', '2005-06-10', '/taKcn26BMWnsUcMFSlr5RfGDtFB.jpg'),
    member('movie:155', 'The Dark Knight : Le Chevalier noir', '2008-07-16', '/pyNXnq8QBWoK3b37RS6C3axwUOy.jpg'),
    member('movie:49026', 'The Dark Knight Rises', '2012-07-17', '/ApcGBERN0p9I0nDOIwJeEmpnLU5.jpg'),
  ]),
  group('dc-extended-universe', 'universe', [
    member('movie:49521', 'Man of Steel', '2013-06-12', '/3HGq0BI0ukKr53oPiTAgOXQprzc.jpg'),
    member('movie:209112', "Batman v Superman : L'Aube de la Justice", '2016-03-23', '/krEWtXK2K7dg5RyMlx9f5WnI1xd.jpg'),
    member('movie:297761', 'Suicide Squad', '2016-08-03', '/5EmbqsAD7lBt5obT1dVwwbR5sra.jpg'),
    member('movie:297762', 'Wonder Woman', '2017-05-30', '/oomdTdke7dqffdDoDV1fFBV4fJY.jpg'),
    member('movie:141052', 'Justice League', '2017-11-15', '/eMlVBnd5NPHDJ3DkhMzokfnymAB.jpg'),
    member('movie:297802', 'Aquaman', '2018-12-07', '/ghbBIweVDjTyx983GQmnCPGlE3U.jpg'),
    member('movie:287947', 'Shazam!', '2019-03-29', '/lhQbFsO6rFoUo3kv5X61G6koiR1.jpg'),
    member('movie:495764', 'Birds of Prey', '2020-02-05', '/14DRJrjIzUE1ZtExRwTP0wOhPwG.jpg'),
    member('movie:464052', 'Wonder Woman 1984', '2020-12-16', '/kdEorjrPno4Cn7HYVN2DA0f3ocr.jpg'),
    member('movie:791373', "Zack Snyder's Justice League", '2021-03-18', '/4EOp3YUSQgzOwVOKrejfKK27bK6.jpg'),
    member('movie:436969', 'The Suicide Squad', '2021-07-28', '/3c8y65VwyFp3pcNtOsrdOoWm8Um.jpg'),
    member('movie:436270', 'Black Adam', '2022-10-19', '/hYALH5NPM7xk2XQd2J8wrfmliIW.jpg'),
    member('movie:594767', 'Shazam! La Rage des Dieux', '2023-03-15', '/iz2V6Wc5eVVBbUqlTIkY4SrS5nW.jpg'),
    member('movie:298618', 'The Flash', '2023-06-13', '/azio74W2qw7bNg7ePqzkWywwK1n.jpg'),
    member('movie:565770', 'Blue Beetle', '2023-08-16', '/xSVtl6ZF7fNuZIoXkZbzI2EzoAD.jpg'),
    member('movie:572802', 'Aquaman et le Royaume perdu', '2023-12-20', '/w8r7NAEIGLPH5r3NhiMobEO80PS.jpg'),
  ]),
  group('arrowverse', 'universe', [
    member('tv:1412', 'Arrow', '2012-10-10', '/4DVLTc7oVCzHOSmZzlDHefCKyqq.jpg'),
    member('tv:60735', 'Flash', '2014-10-07', '/Hrta0iq8KEQbdOpSnki2gUMowk.jpg'),
    member('tv:62688', 'Supergirl', '2015-10-26', '/90mSQajf4STPROA6H7Hh8OvyWdK.jpg'),
    member('tv:62643', "DC's Legends of Tomorrow", '2016-01-21', '/tAwfCIwA2BHR4H6j5hENvI3dbAl.jpg'),
    member('tv:71663', 'Black Lightning', '2018-01-16', '/yWeviNV5vF3lXlFQJSxYo6ozInF.jpg'),
    member('tv:89247', 'Batwoman', '2019-10-06', '/pBpxKiitMuYXvtsXNSzya8DKKzV.jpg'),
  ]),
  group('the-batman-epic-crime-saga', 'universe', [
    member('movie:414906', 'The Batman', '2022-03-01', '/t9JGg10CW1DzXEdWL54ewkUko6N.jpg'),
    member('tv:194764', 'The Penguin', '2024-09-19', '/eV8TTHJOR8AJqPLm9uSLjnItgiU.jpg'),
    member('movie:806704', 'The Batman : PART II', '2028-02-17', '/caeBJHLNld1h14uvcLvzyHf3Rlk.jpg'),
  ]),
  group('dc-universe', 'universe', [
    member('tv:219543', 'Creature Commandos', '2024-12-05', '/bB3G6Ug1jfsOUptb0RJsqrgMVta.jpg'),
    member('movie:1061474', 'Superman', '2025-07-09', '/bL1U8TDb2ZiThIBFAdKHOfpv8lk.jpg'),
  ]),
];

const groupsByMediaKey = new Map<MediaKey, MediaRelationGroup[]>();
for (const relationGroup of MEDIA_RELATION_GROUPS) {
  for (const relationMember of relationGroup.members) {
    const existing = groupsByMediaKey.get(relationMember.mediaKey) || [];
    if (existing.some(candidate => candidate.relationKind === relationGroup.relationKind)) {
      throw new Error(`Relation ${relationGroup.relationKind} dupliquée pour ${relationMember.mediaKey}`);
    }
    groupsByMediaKey.set(relationMember.mediaKey, [...existing, relationGroup]);
  }
}

export function toMediaKey(mediaType: RelationMediaType, tmdbId: number): MediaKey {
  return `${mediaType}:${Number(tmdbId)}`;
}

export function mediaKeyFrom(item: any, fallbackType?: RelationMediaType): MediaKey | null {
  const id = Number(item?.tmdbId ?? item?.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  const mediaType = item?.mediaType || item?.media_type || fallbackType
    || (item?.title !== undefined || item?.release_date !== undefined ? 'movie' : 'tv');
  if (mediaType !== 'movie' && mediaType !== 'tv') return null;
  return toMediaKey(mediaType, id);
}

export function getManifestGroupsForMedia(mediaKey: MediaKey): readonly MediaRelationGroup[] {
  return groupsByMediaKey.get(mediaKey) || [];
}

export function materializeRelationGroup(relationGroup: MediaRelationGroup): any[] {
  return relationGroup.members.map((item, index) => ({
    id: item.tmdbId,
    media_type: item.mediaType,
    ...(item.mediaType === 'movie'
      ? { title: item.label, release_date: item.releaseDate }
      : { name: item.label, first_air_date: item.releaseDate }),
    poster_path: item.posterPath,
    relationGroupId: relationGroup.groupId,
    relationSource: relationGroup.source,
    ...(relationGroup.relationKind === 'saga' ? { sagaOrder: index + 1 } : {}),
  }));
}

export function getManifestRelationSnapshot(mediaKey: MediaKey): MediaRelationSnapshot | null {
  const groups = getManifestGroupsForMedia(mediaKey);
  if (groups.length === 0) return null;
  const saga = groups.find(candidate => candidate.relationKind === 'saga');
  const universe = groups.find(candidate => candidate.relationKind === 'universe');
  return {
    collection: saga ? materializeRelationGroup(saga) : [],
    universe: universe ? materializeRelationGroup(universe) : [],
  };
}

export function relationMediaKeys(items: readonly any[], fallbackType?: RelationMediaType): Set<MediaKey> {
  const keys = new Set<MediaKey>();
  for (const item of items || []) {
    const key = mediaKeyFrom(item, fallbackType);
    if (key) keys.add(key);
  }
  return keys;
}

export class BoundedCache<K, V> {
  private readonly entries = new Map<K, V>();
  private readonly maximumSize: number;

  constructor(maximumSize: number) {
    if (!Number.isInteger(maximumSize) || maximumSize < 1) {
      throw new Error('maximumSize doit être un entier positif');
    }
    this.maximumSize = maximumSize;
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: K): V | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.maximumSize) {
      const oldestKey = this.entries.keys().next().value as K | undefined;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }
  }

  has(key: K): boolean {
    return this.entries.has(key);
  }
}
