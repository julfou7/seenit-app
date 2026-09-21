import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { redactGcpLogExport } = require('../scripts/redact-gcp-log-export.cjs');

test('SEENIT-SECURITY-003 redige les valeurs env Cloud Run avant tout export partageable', () => {
  const raw = [{
    protoPayload: {
      authenticationInfo: { principalEmail: 'operator@example.com' },
      request: {
        spec: {
          template: {
            spec: {
              containers: [{
                env: [
                  { name: 'GITHUB_PAT', value: 'ghp_super_secret_value_123456789' },
                  { name: 'PUBLIC_APP_URL', value: 'https://seenit.ai.studio' },
                  { name: 'TMDB_API_KEY', valueFrom: { secretKeyRef: { name: 'TMDB_API_KEY', key: 'latest' } } },
                ],
              }],
            },
          },
        },
      },
    },
    textPayload: 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456',
  }];

  const redacted = redactGcpLogExport(raw);
  const serialized = JSON.stringify(redacted);

  assert.doesNotMatch(serialized, /ghp_super_secret|seenit\.ai\.studio|abcdefghijklmnopqrstuvwxyz123456|operator@example\.com/);
  assert.match(serialized, /MASQUÉ_ENV/);
  assert.match(serialized, /TMDB_API_KEY/);
  assert.match(serialized, /latest/);
});
