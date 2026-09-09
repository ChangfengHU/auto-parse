export function classifyXhsFailure(message: string) {
  if (/ModuleNotFoundError|No module named|ENOENT|spawn.*python/i.test(message)) return 'runtime_unavailable';
  if (/certificate|SSL|TLS/i.test(message)) return 'tls_error';
  if (/captcha|IP blocked|300012|461|471/i.test(message)) return 'platform_restricted';
  if (/Signature verification|300015/i.test(message)) return 'signature_error';
  if (/Session expired|please re-login/i.test(message)) return 'login_expired';
  if (/timeout|timed out|ECONN|fetch failed/i.test(message)) return 'network_error';
  return 'upstream_error';
}
