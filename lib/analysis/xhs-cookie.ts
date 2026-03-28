/**
 * 小红书 Cookie 存储
 * 跨请求持久（global），服务重启需重新设置
 */

declare global {
  // eslint-disable-next-line no-var
  var __xhsCookieStr: string | undefined;
}

export function setXhsCookie(cookie: string): void {
  global.__xhsCookieStr = cookie.trim();
}

export function getXhsCookie(): string | null {
  return global.__xhsCookieStr ?? null;
}

export function clearXhsCookie(): void {
  global.__xhsCookieStr = undefined;
}

/** 判断是否已设置 Cookie（只要有值就认为已设置，实际有效性需请求才能验证） */
export function hasXhsCookie(): boolean {
  return !!global.__xhsCookieStr;
}
