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

for (const mode of ['success', 'buffer-success', 'buffer-transfer-failure', 'buffer-input-failure', 'buffer-too-large', 'http-failure', 'partial-download', 'input-failure', 'screenshot-failure', 'douyin-success', 'douyin-failed', 'douyin-timeout', 'douyin-login-lost']) {
  test('upload temp directory removed: ' + mode, async () => {
    const dirs = [];
    const bytes = mode === 'buffer-success' ? 'test-video-bytes'.repeat(40000) : 'test-video-bytes';
    class Input { type = 'file'; events = []; dispatchEvent(event) { this.events.push(event.type); } }
    class Transfer { files = []; items = { add: file => this.files.push(file) }; }
    const server = http.createServer((_req, res) => {
      if (mode === 'http-failure') { res.writeHead(404); res.end(); return; }
      if (mode === 'partial-download') {
        res.writeHead(200, { 'Content-Length': 1024 });
        res.write('partial');
        setImmediate(() => res.destroy());
        return;
      }
      res.end(bytes);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const sandbox = { URL, os, path, http, https, pipeline, atob, Uint8Array, File, Event, HTMLInputElement: Input, DataTransfer: Transfer,
      fs: { ...fs, promises: { ...fs.promises, stat: async file => mode === 'buffer-too-large' ? { size: 51 * 1024 * 1024 } : fs.promises.stat(file), mkdtemp: async prefix => {
        const dir = await fs.promises.mkdtemp(prefix); dirs.push(dir); return dir;
      } } },
      captureScreenshot: async () => { if (mode === 'screenshot-failure') throw Error('screenshot'); },
    };
    vm.createContext(sandbox);
    vm.runInContext(source + '\n globalThis.execute = executeFileUpload;', sandbox);
    let consumed = false, disposed = false;
    const chunks = [];
    const page = {
      evaluateHandle: async () => ({ dispose: async () => { disposed = true; } }),
      evaluate: async (fn, { data }) => {
        assert.ok(data.length <= 350000);
        if (mode === 'buffer-transfer-failure') throw Error('transfer_failed');
        fn({ chunks, data });
      },
      url: () => mode.startsWith('douyin-') ? 'https://creator.douyin.com/creator-micro/content/post' : 'https://example.org/upload',
      waitForFunction: async () => {
        assert.equal(fs.readFileSync(path.join(dirs[0], 'video.mp4'), 'utf8'), 'test-video-bytes',
          'selected file must survive asynchronous browser upload');
        if (mode === 'douyin-timeout') throw Error('upload_timeout');
      },
      locator: () => ({ innerText: async () => mode === 'douyin-login-lost' ? '扫码登录 验证码登录' : mode === 'douyin-failed' ? '上传失败，重新上传' : '上传成功 重新上传', first: () => ({
        waitFor: async () => {},
        evaluate: async (fn, { name, mimeType }) => {
          assert.equal(name, 'video.mp4'); assert.equal(mimeType, 'video/mp4');
          if (mode === 'buffer-input-failure') throw Error('input_failed');
          const element = new Input(); fn(element, { chunks, name, mimeType });
          assert.equal(await element.files[0].text(), bytes);
          assert.equal(element.files[0].type, 'video/mp4');
          assert.deepEqual(element.events, ['input', 'change']);
          assert.ok(chunks.length > 1, 'large payload is split across commands'); consumed = true;
        },
        setInputFiles: async file => {
          if (mode === 'buffer-success') {
            assert.equal(file.name, 'video.mp4'); assert.equal(file.mimeType, 'video/mp4');
            assert.equal(file.buffer.toString(), 'test-video-bytes');
          } else assert.equal(fs.readFileSync(file, 'utf8'), 'test-video-bytes');
          if (mode === 'input-failure') throw Error('input');
          consumed = true;
        },
      }) }),
      waitForTimeout: async () => {},
    };
    try {
      const result = await sandbox.execute(page, {
        url: 'http://127.0.0.1:' + server.address().port + '/video.mp4', selector: 'input', transferMode: mode.startsWith('buffer-') ? 'buffer' : 'path',
      }, { emit: () => {} });
      assert.equal(result.success, ['success', 'buffer-success', 'douyin-success'].includes(mode));
      if (mode === 'buffer-too-large') assert.equal(result.error, 'remote_upload_file_too_large');
      if (mode === 'buffer-success') { assert.equal(consumed, true); assert.equal(disposed, true); }
      if (['buffer-transfer-failure', 'buffer-input-failure'].includes(mode)) assert.equal(disposed, true);
      if (mode === 'douyin-login-lost') assert.equal(result.error, 'creator_login_lost_during_upload');
      if (mode === 'success' || mode === 'douyin-success') assert.equal(consumed, true);
      assert.equal(dirs.length, 1);
      for (const dir of dirs) assert.equal(fs.existsSync(dir), false, 'temporary directory leaked');
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      for (const dir of dirs) await fs.promises.rm(dir, { recursive: true, force: true });
    }
  });
}
