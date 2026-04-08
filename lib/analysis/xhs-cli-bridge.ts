import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const DEFAULT_CLI_ROOT = join(process.cwd(), 'python', 'vendors', 'xiaohongshu_cli');
const XHS_CLI_ROOT = process.env.XHS_CLI_ROOT || DEFAULT_CLI_ROOT;
const XHS_CLI_PYTHON = (() => {
  if (process.env.XHS_CLI_PYTHON) return process.env.XHS_CLI_PYTHON;
  const candidates = [
    join(process.cwd(), 'python', '.venv', 'bin', 'python'),
    join(XHS_CLI_ROOT, '.venv', 'bin', 'python'),
  ];
  return candidates.find((p) => existsSync(p)) || 'python3';
})();
const XHS_CLI_ENTRYPOINT = ['-m', 'xhs_cli.cli'] as const;

interface CliErrorPayload {
  code?: string;
  message?: string;
}

interface CliSuccessPayload<T> {
  ok?: boolean;
  data?: T;
  error?: CliErrorPayload;
}

function parseCookieString(cookie: string): Record<string, string> {
  return Object.fromEntries(
    cookie
      .split(';')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const idx = item.indexOf('=');
        return idx === -1 ? null : [item.slice(0, idx).trim(), item.slice(idx + 1).trim()] as const;
      })
      .filter((entry): entry is readonly [string, string] => Boolean(entry?.[0]))
  );
}

async function withCliHome<T>(cookie: string, run: (homeDir: string) => Promise<T>): Promise<T> {
  const homeDir = await mkdtemp(join(tmpdir(), 'xhs-cli-home-'));

  try {
    const configDir = join(homeDir, '.xiaohongshu-cli');
    await mkdir(configDir, { recursive: true, mode: 0o700 });
    await writeFile(join(configDir, 'cookies.json'), JSON.stringify(parseCookieString(cookie), null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    });

    return await run(homeDir);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
}

async function runCliCommand<T>(cookie: string, args: string[]): Promise<T> {
  if (!cookie.trim()) {
    throw new Error('Missing XHS cookie');
  }

  return withCliHome(cookie, async (homeDir) => {
    const { stdout, stderr } = await execFileAsync(
      XHS_CLI_PYTHON,
      [...XHS_CLI_ENTRYPOINT, ...args, '--json'],
      {
        cwd: XHS_CLI_ROOT,
        env: {
          ...process.env,
          HOME: homeDir,
        },
        timeout: 45_000,
        maxBuffer: 8 * 1024 * 1024,
      }
    );

    let payload: CliSuccessPayload<T>;
    try {
      payload = JSON.parse(stdout.trim()) as CliSuccessPayload<T>;
    } catch {
      throw new Error(`Python CLI 输出解析失败: ${stderr || stdout}`.trim());
    }

    if (!payload?.ok) {
      const errorMessage = payload?.error?.message || payload?.error?.code || stderr || 'Python CLI 执行失败';
      throw new Error(String(errorMessage));
    }

    return payload.data as T;
  });
}

export function getXhsCliBridgeConfig() {
  return {
    root: XHS_CLI_ROOT,
    python: XHS_CLI_PYTHON,
  };
}

export async function getXhsUserProfileByCli(cookie: string, userId: string) {
  return runCliCommand<Record<string, unknown>>(cookie, ['user', userId]);
}

export async function getXhsUserPostsByCli(cookie: string, userId: string, cursor = '') {
  const args = ['user-posts', userId];
  if (cursor) args.push('--cursor', cursor);
  return runCliCommand<Record<string, unknown>>(cookie, args);
}

export async function getXhsFeedByCli(cookie: string) {
  return runCliCommand<Record<string, unknown>>(cookie, ['feed']);
}

export async function searchXhsNotesByCli(cookie: string, keyword: string, page = 1) {
  return runCliCommand<Record<string, unknown>>(cookie, ['search', keyword, '--page', String(page)]);
}

export async function getXhsCommentsByCli(
  cookie: string,
  noteId: string,
  options?: { cursor?: string; xsecToken?: string }
) {
  const args = ['comments', noteId];
  if (options?.xsecToken) args.push('--xsec-token', options.xsecToken);
  return runCliCommand<Record<string, unknown>>(cookie, args);
}

export async function getXhsUnreadByCli(cookie: string) {
  return runCliCommand<Record<string, unknown>>(cookie, ['unread']);
}
