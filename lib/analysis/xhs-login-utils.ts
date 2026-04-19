import { execFile } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import { existsSync } from 'fs';

const execFileAsync = promisify(execFile);

// 借用 xhs-cli-bridge 的逻辑寻找 python
const XHS_CLI_PYTHON = (() => {
  if (process.env.XHS_CLI_PYTHON) return process.env.XHS_CLI_PYTHON;
  const candidates = [
    join(process.cwd(), 'python', '.venv', 'bin', 'python'),
    join(process.cwd(), 'python', 'vendors', 'xiaohongshu_cli', '.venv', 'bin', 'python'),
  ];
  return candidates.find((p) => existsSync(p)) || 'python3';
})();

const WORKER_SCRIPT = join(process.cwd(), 'scripts', 'xhs_login_worker.py');

export async function createXhsQr() {
  const { stdout } = await execFileAsync(XHS_CLI_PYTHON, [WORKER_SCRIPT, 'create']);
  const result = JSON.parse(stdout.trim());
  if (!result.ok) throw new Error(result.error || '生成二维码失败');
  return result;
}

export async function pollXhsQr(qr_id: string, code: string, a1: string, webid: string, cookies: any) {
  const { stdout } = await execFileAsync(XHS_CLI_PYTHON, [
    WORKER_SCRIPT,
    'poll',
    qr_id,
    code,
    a1,
    webid,
    JSON.stringify(cookies),
  ]);
  const result = JSON.parse(stdout.trim());
  if (!result.ok) throw new Error(result.error || '轮询二维码状态失败');
  return result;
}
