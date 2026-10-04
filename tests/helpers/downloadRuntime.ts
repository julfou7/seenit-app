import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

/** Remplace les ports externes ; l'entrée métier fournie reste celle de production. */
export async function bundleDownloadRuntime(entry: string, modules: Record<string, string>) {
  const result = await build({
    stdin: { contents: entry, resolveDir: fileURLToPath(new URL('../..', import.meta.url)) },
    bundle: true, platform: 'node', format: 'esm', write: false,
    plugins: [{ name: 'download-runtime-ports', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => {
        const name = args.path.split('/').at(-1)?.replace(/\.ts$/, '') || '';
        const key = Object.hasOwn(modules, args.path) ? args.path : name;
        return Object.hasOwn(modules, key) ? { path: key, namespace: 'fixture' } : undefined;
      });
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: modules[args.path] }));
    } }]
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
