import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync('src/index.css', 'utf8');
const toast = readFileSync('src/components/ToastContainer.tsx', 'utf8');

describe('toast / bottom navigation spacing contract', () => {
  it('keeps one global toast wrapper and gives it clear safe-area-aware breathing room', () => {
    expect(toast).toContain('id="toast-notification-wrapper"');
    expect(css).toContain('#toast-notification-wrapper');
    expect(css).toContain('bottom: calc(6.25rem + env(safe-area-inset-bottom, 0px)) !important;');
    expect(css).toContain('bottom: calc(6.25rem + var(--seenit-safe-area-bottom, env(safe-area-inset-bottom, 0px))) !important;');
  });

  it('does not solve spacing by shrinking compact or media toast touch content', () => {
    expect(toast).toContain('min-h-[64px]');
    expect(toast).toContain('py-2.5');
    expect(toast).toContain('Ignorer les suivants');
    expect(toast).toContain('Annuler');
  });
});
