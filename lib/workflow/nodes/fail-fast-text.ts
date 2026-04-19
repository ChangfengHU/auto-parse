function normalizeJsonish(text: string): string {
  return text
    .replace(/，/g, ',')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
}

function sanitizeToken(token: string): string {
  return token
    .trim()
    .replace(/^[\[\]{}()]+/, '')
    .replace(/[\[\]{}()]+$/, '')
    .replace(/^["'`“”‘’]+/, '')
    .replace(/["'`“”‘’]+$/, '')
    .trim();
}

function isLowSignalToken(token: string): boolean {
  const lower = token.toLowerCase();
  // 高频误判词：在自然描述里极易出现，不能单独作为 fail-fast 判据
  if (['but', 'again', 'wrong', 'error'].includes(lower)) return true;
  if (/^[a-z]+$/i.test(token) && token.length <= 3) return true;
  return false;
}

export function normalizeFailFastTextIncludes(value: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const pushToken = (raw: string) => {
    const token = sanitizeToken(raw);
    if (!token || isLowSignalToken(token) || seen.has(token)) return;
    seen.add(token);
    out.push(token);
  };

  const visit = (input: unknown) => {
    if (Array.isArray(input)) {
      input.forEach(visit);
      return;
    }

    if (input && typeof input === 'object') {
      Object.values(input as Record<string, unknown>).forEach(visit);
      return;
    }

    const text = normalizeJsonish(String(input ?? '').trim());
    if (!text) return;

    if (text.startsWith('[')) {
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
          visit(parsed);
          return;
        }
      } catch {
        // fall through to split mode
      }
    }

    text.split(/[\n,，]/).forEach(pushToken);
  };

  visit(value);
  return out;
}

export function normalizeFailFastAction(value: unknown): 'skip_node' | 'fail_workflow' {
  const raw = String(value ?? '').trim().toLowerCase();
  return raw === 'fail_workflow' ? 'fail_workflow' : 'skip_node';
}
