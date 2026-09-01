from pathlib import Path
import json

server_path = Path('server.ts')
server = server_path.read_text()
import_marker = 'import { evaluatePlexSourceCompletion } from "./src/features/plex/plexSyncIntegrity.ts";'
admin_import = 'import { isSeenItGitAdmin } from "./src/features/admin/gitAdminPolicy.ts";'
if admin_import not in server:
    if import_marker not in server:
        raise SystemExit('Import Plex attendu introuvable dans server.ts')
    server = server.replace(import_marker, import_marker + '\n' + admin_import, 1)

middleware_marker = '};\n\nconst WEBHOOK_SECRET_HEADER'
middleware = '''};

export const requireGitAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!isSeenItGitAdmin(req.user?.uid, process.env.SEENIT_ADMIN_UIDS)) {
    return res.status(403).json({ error: "Accès administrateur requis" });
  }
  next();
};

const WEBHOOK_SECRET_HEADER'''
if 'export const requireGitAdmin' not in server:
    if middleware_marker not in server:
        raise SystemExit('Point d insertion requireGitAdmin introuvable')
    server = server.replace(middleware_marker, middleware, 1)

status_old = "app.get('/api/git/status', requireAuth, async"
status_new = "app.get('/api/git/status', requireAuth, requireGitAdmin, async"
pull_old = "app.post('/api/git/pull', requireAuth, async"
pull_new = "app.post('/api/git/pull', requireAuth, requireGitAdmin, async"
if status_new not in server:
    if status_old not in server:
        raise SystemExit('Route git/status attendue introuvable')
    server = server.replace(status_old, status_new, 1)
if pull_new not in server:
    if pull_old not in server:
        raise SystemExit('Route git/pull attendue introuvable')
    server = server.replace(pull_old, pull_new, 1)
server_path.write_text(server)

policy_path = Path('src/features/admin/gitAdminPolicy.ts')
policy_path.parent.mkdir(parents=True, exist_ok=True)
policy_path.write_text('''export function parseSeenItAdminUids(rawValue: string | null | undefined): Set<string> {
  if (!rawValue) return new Set();
  return new Set(
    rawValue
      .split(/[\\s,;]+/)
      .map(uid => uid.trim())
      .filter(Boolean)
  );
}

export function isSeenItGitAdmin(
  uid: string | null | undefined,
  rawAllowlist: string | null | undefined
): boolean {
  if (!uid) return false;
  return parseSeenItAdminUids(rawAllowlist).has(uid);
}
''')

settings_path = Path('src/screens/SettingsScreen.tsx')
settings = settings_path.read_text()
type_marker = "const DEFAULT_NOTIFICATION_PREFS = {"
if 'type GitAccessState' not in settings:
    settings = settings.replace(type_marker, "type GitAccessState = 'checking' | 'allowed' | 'denied';\n\n" + type_marker, 1)

state_marker = "  // Git Sync state\n  const [gitStatus, setGitStatus] = useState<{"
if "const [gitAccess, setGitAccess]" not in settings:
    if state_marker not in settings:
        raise SystemExit('État Git attendu introuvable dans SettingsScreen')
    settings = settings.replace(
        state_marker,
        "  // Git Sync state\n  const [gitAccess, setGitAccess] = useState<GitAccessState>('checking');\n  const [gitStatus, setGitStatus] = useState<{",
        1
    )

old_fetch = '''  const fetchGitStatus = async () => {
    try {
      if (!auth.currentUser) return;
      const res = await authenticatedFetch('/api/git/status');
      if (res.ok) {
        const data = await res.json();
        setGitStatus(data);
      }
    } catch (err) {
      console.warn('[Git Status] Impossible de récupérer le statut Git', err);
    }
  };

  useEffect(() => {
    fetchGitStatus();
  }, []);
'''
new_fetch = '''  const fetchGitStatus = async () => {
    try {
      if (!auth.currentUser) {
        setGitAccess('checking');
        setGitStatus(null);
        return;
      }
      const res = await authenticatedFetch('/api/git/status');
      if (res.status === 403) {
        setGitAccess('denied');
        setGitStatus(null);
        setGitOutputText('');
        setShowGitOutput(false);
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setGitAccess('allowed');
        setGitStatus(data);
        return;
      }
      setGitAccess('checking');
      setGitStatus(null);
    } catch (err) {
      setGitAccess('checking');
      setGitStatus(null);
      console.warn('[Git Status] Impossible de récupérer le statut Git', err);
    }
  };

  useEffect(() => {
    if (!user) {
      setGitAccess('checking');
      setGitStatus(null);
      return;
    }
    void fetchGitStatus();
  }, [user?.uid]);
'''
if old_fetch not in settings:
    raise SystemExit('Bloc fetchGitStatus attendu introuvable')
settings = settings.replace(old_fetch, new_fetch, 1)

pull_marker = "      const data = await res.json();\n      if (data.success) {"
pull_replacement = '''      const data = await res.json();
      if (res.status === 403) {
        setGitAccess('denied');
        setGitStatus(null);
        setGitOutputText('');
        setShowGitOutput(false);
        showToast("Accès administrateur requis.", "error");
        return;
      }
      if (data.success) {'''
if pull_replacement not in settings:
    if pull_marker not in settings:
        raise SystemExit('Point de contrôle Git Pull introuvable')
    settings = settings.replace(pull_marker, pull_replacement, 1)

card_start = '''              {/* GitHub Git Sync Card */}
              <div className="p-3 bg-zinc-800/40 border border-zinc-800 rounded-xl flex flex-col gap-2.5">'''
card_new = '''              {/* GitHub Git Sync Card */}
              {gitAccess === 'allowed' && (
              <div className="p-3 bg-zinc-800/40 border border-zinc-800 rounded-xl flex flex-col gap-2.5">'''
if card_new not in settings:
    if card_start not in settings:
        raise SystemExit('Carte Git attendue introuvable')
    settings = settings.replace(card_start, card_new, 1)

card_end = '''              </div>

              {/* Updater Progress */}'''
card_end_new = '''              </div>
              )}

              {/* Updater Progress */}'''
if card_end_new not in settings:
    if card_end not in settings:
        raise SystemExit('Fin de carte Git attendue introuvable')
    settings = settings.replace(card_end, card_end_new, 1)
settings_path.write_text(settings)

env_path = Path('.env.example')
env = env_path.read_text()
if 'SEENIT_ADMIN_UIDS=' not in env:
    env += '''

# SEENIT_ADMIN_UIDS: UID Firebase autorisés à consulter le statut Git et déclencher un pull.
# Plusieurs UID peuvent être séparés par une virgule. Absent ou vide = accès Git refusé.
SEENIT_ADMIN_UIDS=
'''
env_path.write_text(env)

spec_path = Path('docs/specifications/seenit.md')
spec = spec_path.read_text()
old_security = '''- **SEENIT-SECURITY-002** — Les routes de diagnostic et de synchronisation Git exigent une session
  Firebase SeenIt et les clients PWA/APK utilisent le transport authentifié commun. Le statut Git,
  les chemins locaux, les sorties de commande et les erreurs ne sont jamais publics.
'''
new_security = '''- **SEENIT-SECURITY-002** — Les routes de diagnostic et de synchronisation Git exigent une session
  Firebase SeenIt puis un UID présent exactement dans l'allowlist serveur `SEENIT_ADMIN_UIDS`. Une
  allowlist absente ou vide refuse tout accès Git, notamment en production. Un UID non administrateur
  reçoit uniquement un `403` générique, sans chemin, sortie de commande ou détail d'exploitation ;
  les clients PWA/APK utilisent le transport authentifié commun et ne rendent la section Git qu'après
  confirmation de l'autorisation par le serveur.
'''
if old_security not in spec:
    raise SystemExit('SEENIT-SECURITY-002 attendu introuvable dans la SPEC')
spec_path.write_text(spec.replace(old_security, new_security, 1))

test_path = Path('tests/gitAdminPolicy.test.ts')
test_path.write_text('''import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isSeenItGitAdmin, parseSeenItAdminUids } from '../src/features/admin/gitAdminPolicy.ts';

test('SEENIT-SECURITY-002 refuse les opérations Git sans allowlist administrateur', () => {
  assert.equal(isSeenItGitAdmin('uid-admin', undefined), false);
  assert.equal(isSeenItGitAdmin('uid-admin', ''), false);
  assert.equal(isSeenItGitAdmin(undefined, 'uid-admin'), false);
});

test('SEENIT-SECURITY-002 compare exactement les UID administrateurs côté serveur', () => {
  const allowlist = parseSeenItAdminUids(' uid-a,uid-b\\nuid-c ; uid-d ');
  assert.deepEqual([...allowlist], ['uid-a', 'uid-b', 'uid-c', 'uid-d']);
  assert.equal(isSeenItGitAdmin('uid-b', 'uid-a,uid-b'), true);
  assert.equal(isSeenItGitAdmin('uid', 'uid-admin'), false);
  assert.equal(isSeenItGitAdmin('UID-B', 'uid-b'), false);
});

test('SEENIT-SECURITY-002 protège les routes Git et masque les outils aux non-administrateurs', () => {
  const server = readFileSync('server.ts', 'utf8');
  const settings = readFileSync('src/screens/SettingsScreen.tsx', 'utf8');
  assert.match(server, /app\.get\('\/api\/git\/status', requireAuth, requireGitAdmin,/);
  assert.match(server, /app\.post\('\/api\/git\/pull', requireAuth, requireGitAdmin,/);
  assert.match(server, /status\(403\)\.json\(\{ error: "Accès administrateur requis" \}\)/);
  assert.match(settings, /res\.status === 403/);
  assert.match(settings, /gitAccess === 'allowed'/);
  assert.doesNotMatch(settings, /SEENIT_ADMIN_UIDS/);
});
''')

req_path = Path('docs/specifications/requirements.json')
req = json.loads(req_path.read_text())
security = next((item for item in req['requirements'] if item.get('id') == 'SEENIT-SECURITY-002'), None)
if not security:
    raise SystemExit('SEENIT-SECURITY-002 introuvable dans requirements.json')
additions = [
    {
        'file': 'tests/gitAdminPolicy.test.ts',
        'contains': 'SEENIT-SECURITY-002 refuse les opérations Git sans allowlist administrateur'
    },
    {
        'file': 'tests/gitAdminPolicy.test.ts',
        'contains': 'SEENIT-SECURITY-002 protège les routes Git et masque les outils aux non-administrateurs'
    }
]
existing = {(item.get('file'), item.get('contains')) for item in security.get('tests', [])}
for addition in additions:
    if (addition['file'], addition['contains']) not in existing:
        security.setdefault('tests', []).append(addition)
req_path.write_text(json.dumps(req, ensure_ascii=False, indent=2) + '\n')

gradle_path = Path('android/app/build.gradle')
gradle = gradle_path.read_text()
if 'versionName "1.4.88"' not in gradle or 'versionCode 104088' not in gradle:
    raise SystemExit('Version de départ 1.4.88 inattendue')
gradle = gradle.replace('versionCode 104088', 'versionCode 104089', 1)
gradle = gradle.replace('versionName "1.4.88"', 'versionName "1.4.89"', 1)
gradle_path.write_text(gradle)
