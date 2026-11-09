import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { selectTouchedTests } = require('../scripts/test-touched.cjs') as {
  selectTouchedTests: (changed: string[], tests: string[], read: (test: string) => string) => string[];
};

// Rétrospective du 09/11 : un ancien TNR qui lit ProgrammedSection.tsx n'avait été trouvé que par la validation
// complète. Le préflight lance désormais tous les TNR qui citent un fichier modifié.
test('préflight : les TNR qui citent un fichier modifié sont lancés, y compris les anciens TNR de source', () => {
  const sources: Record<string, string> = {
    'tests/programmedCalendar.test.ts': "readFileSync('src/components/ProgrammedSection.tsx')",
    'tests/detailFieldFeedback.test.ts': "read('src/components/ProgrammedSection.tsx')",
    'tests/toastNavigation.test.ts': "from '../src/features/toasts/toastNavigation.ts'",
    'tests/unrelated.test.ts': "from '../src/lib/utils.ts'",
    'tests/new.test.ts': 'rien'
  };
  const tests = Object.keys(sources);
  const changed = ['src/components/ProgrammedSection.tsx', 'src/lib/utils.ts', 'docs/process/delivery.md', 'tests/new.test.ts'];
  assert.deepEqual(selectTouchedTests(changed, tests, test => sources[test]), ['tests/detailFieldFeedback.test.ts', 'tests/new.test.ts', 'tests/programmedCalendar.test.ts'],
    'utils, trop générique, ne relance pas toute la suite ; un TNR modifié est toujours lancé');
  assert.deepEqual(selectTouchedTests(['src/features/toasts/toastNavigation.ts'], tests, test => sources[test]), ['tests/toastNavigation.test.ts']);
  assert.deepEqual(selectTouchedTests(['docs/process/delivery.md'], tests, test => sources[test]), [], 'documentation seule : aucun TNR');
});
