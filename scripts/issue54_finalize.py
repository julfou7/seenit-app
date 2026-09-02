from pathlib import Path
import json


test_path = Path('tests/downloadIdentity.test.ts')
tests = test_path.read_text(encoding='utf-8')
# Le scénario transitoire représente un snapshot qBittorrent. Un item Radarr
# déjà identifié n'emprunte pas ce chemin de rattachement temporaire.
tests = tests.replace(
    "id: 'radarr_robin', mediaType: 'movie' as const, tmdbId: 1181198,",
    "id: 'qbit_robin', mediaType: 'movie' as const, tmdbId: 1181198,"
)
marker = "test('SEENIT-DOWNLOAD-002 deux vrais infohash différents ne sont jamais fusionnés'"
if marker not in tests:
    tests += """

test('SEENIT-DOWNLOAD-002 deux vrais infohash différents ne sont jamais fusionnés', () => {
  const a = { downloadId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' };
  const b = { downloadId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' };
  assert.equal(hasConflictingStrongPhysicalIds(a, b), true);
  assert.equal(samePhysicalDownload(a, b), false);
});
"""
test_path.write_text(tests, encoding='utf-8')

req_path = Path('docs/specifications/requirements.json')
req = json.loads(req_path.read_text(encoding='utf-8'))
by_id = {item['id']: item for item in req['requirements']}
by_id['SEENIT-DOWNLOAD-002']['tests'] = [{
    'file': 'tests/downloadIdentity.test.ts',
    'contains': 'SEENIT-DOWNLOAD-002 deux vrais infohash différents ne sont jamais fusionnés'
}]
by_id['SEENIT-QUALITY-005']['tests'] = [{
    'file': 'tests/firebaseIdentityGuardrails.test.ts',
    'contains': 'SEENIT-QUALITY-005 matérialise Firebase Android et répare les droits Gradle'
}]
req_path.write_text(json.dumps(req, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
