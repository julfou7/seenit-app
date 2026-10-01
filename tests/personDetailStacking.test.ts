import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const personDetail = readFileSync('src/screens/PersonDetailModal.tsx', 'utf8');
const gridMediaCard = readFileSync('src/components/GridMediaCard.tsx', 'utf8');

test('la filmographie de la fiche personne enferme les cartes sous son header sticky', () => {
  assert.ok(
    personDetail.includes(
      'className="relative seenit-dialog-header pb-2.5 px-4 flex items-center justify-between z-20 sticky top-0'
    )
  );
  assert.ok(
    personDetail.includes(
      'className="relative z-0 grid grid-cols-2 gap-x-3 gap-y-4 px-1"'
    )
  );
  assert.ok(
    gridMediaCard.includes(
      'className="absolute top-0 right-0 z-30 bg-white/95'
    )
  );
});

test('la prévisualisation reste hors du stacking context de la grille filmographie', () => {
  const gridIndex = personDetail.indexOf(
    'className="relative z-0 grid grid-cols-2 gap-x-3 gap-y-4 px-1"'
  );
  const previewIndex = personDetail.indexOf(
    '{/* Modal de prévisualisation partagée (QuickPreviewModal / long-press) */}'
  );

  assert.notEqual(gridIndex, -1);
  assert.notEqual(previewIndex, -1);
  assert.ok(previewIndex > gridIndex);
  assert.ok(personDetail.includes('<QuickPreviewModal'));
});
