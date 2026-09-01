const { rmSync } = require('node:fs');

for (const target of ['dist', 'server.js']) {
  rmSync(target, { recursive: true, force: true });
}
