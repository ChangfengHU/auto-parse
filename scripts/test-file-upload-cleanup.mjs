import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { pipeline } from 'node:stream/promises';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { test } from 'node:test';

const source = stripTypeScriptTypes(fs.readFileSync(new URL('../lib/workflow/nodes/file-upload.ts', import.meta.url), 'utf8'), { mode: 'transform' })
  .replace(/^import .*;\s*$/gm, '').replace(/^export /gm, '');

for (const mode of ['success', 'http-failure', 'partial-download', 'input-failure', 'screenshot-failure']) {
  test('upload temp directory removed: ' + mode, async () => {
    const dirs = [];
    const server = http.createServer((_req, res) => {
      if (mode === 'http-failure') { res.writeHead(404); res.end(); return; }
      if (mode === 'partial-download') {
        res.writeHead(200, { 'Content-Length': 1024 });
        res.write('partial');
        setImmediate(() => res.destroy());
        return;
      }
      res.end('test-video-bytes');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const sandbox = { URL, os, path, http, https, pipeline,
      fs: { ...fs, promises: { ...fs.promises, mkdtemp: async prefix => {
        const dir = await fs.promises.mkdtemp(prefix); dirs.push(dir); return dir;
      } } },
      captureScreenshot: async () => { if (mode === 'screenshot-failure') throw Error('screenshot'); },
    };
    vm.createContext(sandbox);
    vm.runInContext(source + '\n globalThis.execute = executeFileUpload;', sandbox);
    let consumed = false;
    const page = {
      locator: () => ({ first: () => ({
        waitFor: async () => {},
        setInputFiles: async file => {
          assert.equal(fs.readFileSync(file, 'utf8'), 'test-video-bytes');
          if (mode === 'input-failure') throw Error('input');
          consumed = true;
        },
      }) }),
      waitForTimeout: async () => {},
    };
    try {
      const result = await sandbox.execute(page, {
        url: 'http://127.0.0.1:' + server.address().port + '/video.mp4', selector: 'input',
      }, { emit: () => {} });
      assert.equal(result.success, mode === 'success');
      if (mode === 'success') assert.equal(consumed, true);
      assert.equal(dirs.length, 1);
      for (const dir of dirs) assert.equal(fs.existsSync(dir), false, 'temporary directory leaked');
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      for (const dir of dirs) await fs.promises.rm(dir, { recursive: true, force: true });
    }
  });
}
