/**
 * Gemini Cookie 存储
 * 持久化到本地文件，服务重启后自动恢复
 */

import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';

const COOKIE_FILE = join(process.cwd(), '.gemini-cookie');

declare global {
  var __geminiCookieStr: string | undefined;
}

function loadCookieFromFile(): string | null {
  try {
    if (existsSync(COOKIE_FILE)) {
      return readFileSync(COOKIE_FILE, 'utf-8').trim();
    }
  } catch (error) {
    console.error('Failed to load Gemini cookie from file:', error);
  }
  return null;
}

function saveCookieToFile(cookie: string): void {
  try {
    writeFileSync(COOKIE_FILE, cookie, 'utf-8');
  } catch (error) {
    console.error('Failed to save Gemini cookie to file:', error);
  }
}

function deleteCookieFile(): void {
  try {
    if (existsSync(COOKIE_FILE)) {
      unlinkSync(COOKIE_FILE);
    }
  } catch (error) {
    console.error('Failed to delete Gemini cookie file:', error);
  }
}

export function setGeminiCookie(cookie: string): void {
  const cleaned = cookie.trim();
  global.__geminiCookieStr = cleaned;
  saveCookieToFile(cleaned);
}

export function getGeminiCookie(): string | null {
  if (global.__geminiCookieStr) {
    return global.__geminiCookieStr;
  }
  const fromFile = loadCookieFromFile();
  if (fromFile) {
    global.__geminiCookieStr = fromFile;
    return fromFile;
  }
  return null;
}

export function clearGeminiCookie(): void {
  global.__geminiCookieStr = undefined;
  deleteCookieFile();
}

export function hasGeminiCookie(): boolean {
  return !!getGeminiCookie();
}
