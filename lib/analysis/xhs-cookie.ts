/**
 * 小红书 Cookie 存储
 * 持久化到本地文件，服务重启后自动恢复
 */

import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';

const COOKIE_FILE = join(process.cwd(), '.xhs-cookie');

declare global {
  // eslint-disable-next-line no-var
  var __xhsCookieStr: string | undefined;
}

function loadCookieFromFile(): string | null {
  try {
    if (existsSync(COOKIE_FILE)) {
      return readFileSync(COOKIE_FILE, 'utf-8').trim();
    }
  } catch (error) {
    console.error('Failed to load XHS cookie from file:', error);
  }
  return null;
}

function saveCookieToFile(cookie: string): void {
  try {
    writeFileSync(COOKIE_FILE, cookie, 'utf-8');
  } catch (error) {
    console.error('Failed to save XHS cookie to file:', error);
  }
}

function deleteCookieFile(): void {
  try {
    if (existsSync(COOKIE_FILE)) {
      unlinkSync(COOKIE_FILE);
    }
  } catch (error) {
    console.error('Failed to delete XHS cookie file:', error);
  }
}

export function setXhsCookie(cookie: string): void {
  const cleaned = cookie.trim();
  global.__xhsCookieStr = cleaned;
  saveCookieToFile(cleaned);
}

export function getXhsCookie(): string | null {
  // 优先从内存获取，如果没有则从文件加载
  if (global.__xhsCookieStr) {
    return global.__xhsCookieStr;
  }
  
  const fromFile = loadCookieFromFile();
  if (fromFile) {
    global.__xhsCookieStr = fromFile;
    return fromFile;
  }
  
  return null;
}

export function clearXhsCookie(): void {
  global.__xhsCookieStr = undefined;
  deleteCookieFile();
}

/** 判断是否已设置 Cookie（只要有值就认为已设置，实际有效性需请求才能验证） */
export function hasXhsCookie(): boolean {
  return !!getXhsCookie();
}
