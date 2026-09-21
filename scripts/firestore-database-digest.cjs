const crypto = require('node:crypto');
const { v1 } = require('@google-cloud/firestore');

function canonicalizeFirestoreValue(value) {
  if (value === null) return null;
  if (value === undefined) return { __type: 'undefined' };
  if (typeof value === 'bigint') return { __type: 'bigint', value: value.toString() };
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return { __type: 'number', value: 'NaN' };
    if (value === Infinity) return { __type: 'number', value: 'Infinity' };
    if (value === -Infinity) return { __type: 'number', value: '-Infinity' };
    if (Object.is(value, -0)) return { __type: 'number', value: '-0' };
    return value;
  }
  if (typeof value !== 'object') return value;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { __type: 'bytes', value: Buffer.from(value).toString('base64') };
  }
  if (value instanceof Date) return { __type: 'date', value: value.toISOString() };
  if (Array.isArray(value)) return value.map(canonicalizeFirestoreValue);

  const constructorName = value.constructor?.name;
  if (constructorName === 'Timestamp' && typeof value.seconds === 'number') {
    return {
      __type: 'timestamp',
      nanoseconds: value.nanoseconds,
      seconds: value.seconds
    };
  }
  if (constructorName === 'GeoPoint') {
    return {
      __type: 'geopoint',
      latitude: value.latitude,
      longitude: value.longitude
    };
  }
  if (constructorName === 'DocumentReference' && typeof value.path === 'string') {
    return { __type: 'reference', path: value.path };
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map(key => [key, canonicalizeFirestoreValue(value[key])])
  );
}

function canonicalDocumentLine(path, data) {
  return `${path}\u0000${JSON.stringify(canonicalizeFirestoreValue(data))}\n`;
}

function normalizeRestFields(value, databasePrefix) {
  if (Array.isArray(value)) return value.map(item => normalizeRestFields(item, databasePrefix));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map(key => {
        const nested = value[key];
        if (key === 'referenceValue' && typeof nested === 'string') {
          return [key, nested.startsWith(databasePrefix) ? nested.slice(databasePrefix.length) : nested];
        }
        return [key, normalizeRestFields(nested, databasePrefix)];
      })
  );
}

async function digestDatabase(databaseId, options = {}) {
  const projectId = options.projectId || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
  if (!projectId) throw new Error('GOOGLE_CLOUD_PROJECT est requis.');
  const restDatabaseId = databaseId === 'default' ? '(default)' : databaseId;
  const rootName = `projects/${projectId}/databases/${restDatabaseId}/documents/`;
  const rootParent = rootName.slice(0, -1);
  const client = new v1.FirestoreClient({ projectId });
  const hash = crypto.createHash('sha256');
  const collectionGroupCounts = new Map();
  const visited = new Set();
  let documentCount = 0;

  async function listChildren(parentPath) {
    const parent = parentPath ? `${rootParent}/${parentPath}` : rootParent;
    const [documents] = await client.listDocuments({
      parent,
      pageSize: 1000,
      showMissing: true
    });
    return documents;
  }

  async function visitParent(parentPath) {
    const documents = await listChildren(parentPath);
    const ordered = documents.sort((left, right) => left.name.localeCompare(right.name));
    for (const document of ordered) {
      if (typeof document.name !== 'string' || !document.name.startsWith(rootName)) {
        throw new Error(`Nom de document inattendu dans ${restDatabaseId}.`);
      }
      const path = document.name.slice(rootName.length);
      if (visited.has(path)) continue;
      visited.add(path);
      const exists = Object.hasOwn(document, 'fields') || document.createTime || document.updateTime;
      if (exists) {
        const segments = path.split('/');
        const collectionId = segments.at(-2);
        documentCount += 1;
        collectionGroupCounts.set(collectionId, (collectionGroupCounts.get(collectionId) || 0) + 1);
        hash.update(canonicalDocumentLine(path, normalizeRestFields(document.fields || {}, rootName)));
      }
      await visitParent(path);
    }
  }

  try {
    await visitParent('');
    return {
      databaseId,
      documentCount,
      collectionGroupCounts: Object.fromEntries([...collectionGroupCounts.entries()].sort()),
      digest: hash.digest('hex')
    };
  } finally {
    await client.close();
  }
}

async function main() {
  const databaseId = process.argv[2];
  if (!databaseId || process.argv.length !== 3) {
    throw new Error('Usage: node scripts/firestore-database-digest.cjs <database-id>');
  }
  const report = await digestDatabase(databaseId);
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

module.exports = {
  canonicalDocumentLine,
  canonicalizeFirestoreValue,
  digestDatabase,
  normalizeRestFields
};

if (require.main === module) {
  main().catch(error => {
    console.error(`[Firestore digest] ${error.message}`);
    process.exitCode = 1;
  });
}
