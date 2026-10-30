import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('../tv-samsung/tools/q6fn-home-route-probe.ps1', import.meta.url),
  'utf8'
);

function embeddedCommands(): string[] {
  return Array.from(source.matchAll(/Command\s*=\s*@'([\s\S]*?)'@/g), match => match[1]);
}

test('#295 le probe Q6FN reste strictement read-only', () => {
  const commands = embeddedCommands();
  assert.ok(commands.length >= 10, 'les sondes terrain doivent rester explicites et bornées');
  const joined = commands.join('\n');

  assert.doesNotMatch(
    joined,
    /\bsqlite3\b[^\r\n]*(?:\bUPDATE\b|\bINSERT\b|\bDELETE\b|\bREPLACE\b|\bDROP\b|\bALTER\b|\bCREATE\b|\bVACUUM\b|\bATTACH\b|\bDETACH\b)/i
  );
  assert.doesNotMatch(joined, /\bvconftool\s+(?:set|unset|add)\b/i);
  assert.doesNotMatch(
    joined,
    /^\s*(?:mount|umount|reboot|poweroff|shutdown|rm|mv|cp|chmod|chown|dd|kill|pkill)\b/im
  );
  assert.doesNotMatch(joined, /\bsystemctl\s+(?:start|stop|restart|enable|disable|mask|unmask)\b/i);
  assert.doesNotMatch(joined, /\bvd_app(?:install|uninstall)\b/i);
  assert.doesNotMatch(joined, /\barchive-root\b/i);
  assert.doesNotMatch(joined, /\bsetcap\b|\bsetfattr\b|\bchsmack\b/i);

  assert.doesNotMatch(source, /&\s*\$SdbPath[^\r\n]*\b(?:connect|push|install|uninstall)\b/i);
  assert.doesNotMatch(source, /\b(?:Set-Content|Add-Content|Out-File|Invoke-Expression)\b/);
  assert.doesNotMatch(source, /192\.168\.|10\.\d+\.|172\.(?:1[6-9]|2\d|3[01])\./);
});

test('#295 sonde les preuves qui distinguent no-root, root moderne et port old-Tizen', () => {
  assert.match(source, /\/usr\/bin\/corerun/);
  assert.match(source, /\/usr\/bin\/dotnet/);
  assert.match(source, /\/usr\/sbin\/sdbd-tarlauncher/);
  assert.match(source, /getcap/);
  assert.match(source, /--to-command/);
  assert.match(source, /\/proc\/self\/ns\/mnt/);

  for (const symbol of [
    'app_control_set_defapp',
    'app_operation_(get|set)_current_app',
    'aul_get_default_app',
    'vconf_(get|set)_(str|int)'
  ]) {
    assert.match(source, new RegExp(symbol));
  }
});

test('#295 relit la route Home existante sans jamais l’écrire', () => {
  assert.match(source, /sqlite3 -readonly \/opt\/dbspace\/\.app-context\.db/);
  assert.match(source, /PRAGMA query_only=ON/);
  assert.match(source, /SELECT rowid,\* FROM key_filter WHERE rowid=41/);
  assert.match(source, /XF86Home/);
  assert.match(source, /memory\/appfw\/app_context_db_change/);
  assert.match(source, /MUTATION_ATTEMPTED=0/);
});
