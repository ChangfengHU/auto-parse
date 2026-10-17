import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { test } from 'node:test';
const source = stripTypeScriptTypes(await readFile(new URL('../lib/workflow/nodes/shadow-button.ts', import.meta.url), 'utf8'), { mode: 'transform' }).replace(/^import .*;\s*$/gm, '').replace(/^export /gm, '');
const normal = { shadowHostSelector: 'xhs-publish-btn', text: '暂存离开' };
for (const scenario of ['success', 'wrong-text', 'duplicate', 'disabled', 'aria-disabled', 'hidden', 'transparent', 'tiny', 'outside', 'obscured', 'outer-obscured', 'two-hosts', 'no-root', 'cdp-error', 'missing-text', 'mixed-selector', 'mixed-elements', 'mixed-useSelector', 'publication']) {
  test('closed shadow button fails closed: ' + scenario, async () => {
    const params = { ...normal };
    if (scenario === 'missing-text') params.text = '';
    if (scenario === 'mixed-selector') params.selector = 'button';
    if (scenario === 'mixed-elements') params.elements = [{ text: '发布' }];
    if (scenario === 'mixed-useSelector') params.useSelector = true;
    if (scenario === 'publication') params.douyinPublication = {};
    const clicks = []; let attached = false, detached = false;
    const host = {};
    const button = {
      innerText: scenario === 'wrong-text' ? '发布' : '暂存离开',
      disabled: scenario === 'disabled',
      getAttribute: () => scenario === 'aria-disabled' ? 'true' : null,
      contains: () => false,
      getBoundingClientRect: () => ({ x: scenario === 'outside' ? 1000 : 20, y: 30, width: scenario === 'tiny' ? 0 : 120, height: 40 }),
    };
    const root = {
      host,
      querySelectorAll: () => scenario === 'duplicate' ? [button, button] : [button],
      elementFromPoint: () => scenario === 'obscured' ? {} : button,
    };
    const cdp = { detach: async () => { detached = true; }, send: async (method, input) => {
      if (scenario === 'cdp-error') throw Error('cdp_unavailable');
      if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
      if (method === 'DOM.querySelector') return { nodeId: 2 };
      if (method === 'DOM.describeNode') return { node: { shadowRoots: scenario === 'no-root' ? [] : [{ backendNodeId: 3 }] } };
      if (method === 'DOM.resolveNode') return { object: { objectId: 'root' } };
      if (method === 'Runtime.callFunctionOn') {
        const realm = { document: { elementFromPoint: () => scenario === 'outer-obscured' ? {} : host }, innerWidth: 712, innerHeight: 809, getComputedStyle: () => ({ visibility: scenario === 'hidden' ? 'hidden' : 'visible', display: 'block', opacity: scenario === 'transparent' ? '0' : '1' }) };
        const callback = vm.runInNewContext('(' + input.functionDeclaration + ')', realm);
        return { result: { value: callback.call(root, input.arguments[0].value) } };
      }
      throw Error('unexpected CDP method ' + method);
    }};
    const loc = { first: () => loc, waitFor: async () => {}, count: async () => scenario === 'two-hosts' ? 2 : 1, scrollIntoViewIfNeeded: async () => {} };
    const page = { locator: () => loc, context: () => ({ newCDPSession: async () => { attached = true; return cdp; } }), mouse: { click: async (...args) => clicks.push(args) } };
    const realm = { captureScreenshot: async () => undefined };
    vm.createContext(realm); vm.runInContext(source, realm);
    const result = await realm.executeShadowButtonClick(page, params);
    assert.equal(result.success, scenario === 'success');
    assert.equal(clicks.length, scenario === 'success' ? 1 : 0);
    if (scenario === 'success') assert.deepEqual(clicks[0], [80, 50]);
    if (attached) assert.equal(detached, true);
  });
}
