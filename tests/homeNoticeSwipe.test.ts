import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';

test('SEENIT-UX-018 le swipe retire une notification sans confondre scroll clic et action métier', async () => {
  const bundle = await build({ entryPoints: ['src/components/cards/HomeNoticeSwipe.tsx'], bundle: true, write: false, platform: 'node', format: 'cjs',
    plugins: [{ name: 'notice-gesture-ports', setup(builder) {
      builder.onResolve({ filter: /^(?:react(?:\/jsx-runtime)?|lucide-react)$/ }, args => ({ path: args.path, namespace: 'ports' }));
      builder.onLoad({ filter: /.*/, namespace: 'ports' }, () => ({ contents: 'export const useRef=value=>({current:value});export const useState=value=>[value,()=>{}];export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Trash2=()=>null;' }));
    } }],
  });
  const module = { exports: {} as { HomeNoticeSwipe: (props: { children: string; onDismiss: () => void }) => { props: Record<string, (event: unknown) => void> } } };
  vm.runInContext(bundle.outputFiles[0].text, vm.createContext({ module }));
  for (const gesture of [
    { dx: -71, dy: 0, dismissed: 0 }, { dx: -100, dy: 0, dismissed: 1 },
    { dx: 100, dy: 0, dismissed: 0 }, { dx: -10, dy: 100, dismissed: 0 },
    { dx: -100, dy: 0, action: true, dismissed: 0 }, { dx: -100, dy: 0, cancel: true, dismissed: 0 },
  ]) {
    let dismissed = 0, blockedClick = false;
    const handlers = module.exports.HomeNoticeSwipe({ children: 'Une notification', onDismiss: () => dismissed++ }).props;
    const pointer = { button: 0, pointerId: 1, clientX: 200, clientY: 100, target: { closest: () => gesture.action ? {} : null }, currentTarget: { setPointerCapture() {} }, preventDefault() {}, stopPropagation() {} };
    handlers.onPointerDown(pointer);
    handlers.onPointerMove({ ...pointer, clientX: 200 + gesture.dx, clientY: 100 + gesture.dy });
    if (gesture.cancel) handlers.onPointerCancel(pointer);
    handlers.onPointerUp(pointer);
    handlers.onClickCapture({ preventDefault: () => { blockedClick = true; }, stopPropagation() {} });
    assert.equal(dismissed, gesture.dismissed, JSON.stringify(gesture));
    if (gesture.dismissed) assert.equal(blockedClick, true, 'le clic final du swipe ne déclenche pas l’ouverture du média');
  }
});
