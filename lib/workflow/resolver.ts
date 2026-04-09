/**
 * 模板变量解析器
 * 把 "{{title}}" 替换为实际值
 */
export function resolveTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

/** 递归解析对象中所有字符串值的模板变量 */
export function resolveParams<T extends Record<string, unknown>>(
  params: T,
  vars: Record<string, string>
): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') {
      result[key] = resolveTemplate(value, vars);
    } else if (Array.isArray(value)) {
      result[key] = value.map(v => {
        if (typeof v === 'string') return resolveTemplate(v, vars);
        if (v && typeof v === 'object') return resolveParams(v as Record<string, unknown>, vars);
        return v;
      });
    } else if (value && typeof value === 'object') {
      result[key] = resolveParams(value as Record<string, unknown>, vars);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}
