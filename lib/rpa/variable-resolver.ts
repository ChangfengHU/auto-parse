/**
 * 变量解析器
 * 
 * 支持 ${variableName} 语法，在运行时替换为实际值
 */

export class VariableResolver {
  private variables: Map<string, string>;

  constructor(initialVariables: Record<string, string> = {}) {
    this.variables = new Map(Object.entries(initialVariables));
  }

  /** 获取变量值 */
  get(key: string): string | undefined {
    return this.variables.get(key);
  }

  /** 设置变量值 */
  set(key: string, value: string): void {
    this.variables.set(key, value);
  }

  /** 删除变量 */
  delete(key: string): boolean {
    return this.variables.delete(key);
  }

  /** 检查变量是否存在 */
  has(key: string): boolean {
    return this.variables.has(key);
  }

  /** 批量设置变量 */
  setAll(vars: Record<string, string>): void {
    for (const [key, value] of Object.entries(vars)) {
      this.variables.set(key, value);
    }
  }

  /** 获取所有变量 */
  getAll(): Record<string, string> {
    return Object.fromEntries(this.variables);
  }

  /** 清空所有变量 */
  clear(): void {
    this.variables.clear();
  }

  /**
   * 解析模板字符串
   * 支持 ${variableName} 语法
   * 
   * @example
   * resolver.set('name', 'world');
   * resolver.resolve('Hello ${name}!') // => 'Hello world!'
   * 
   * 支持嵌套和默认值（未来扩展）:
   * ${name:-default}  // 变量不存在时使用默认值
   * ${name:+exists}   // 变量存在时使用替代值
   */
  resolve(template: string): string {
    if (!template || typeof template !== 'string') {
      return template ?? '';
    }

    // 匹配 ${variableName} 或 ${variableName:-defaultValue}
    return template.replace(/\$\{([^}]+)\}/g, (match, expr) => {
      // 检查是否有默认值语法 ${var:-default}
      const defaultMatch = expr.match(/^(\w+):-(.*)$/);
      if (defaultMatch) {
        const [, varName, defaultValue] = defaultMatch;
        return this.variables.get(varName) ?? defaultValue;
      }

      // 检查是否有存在替代语法 ${var:+replacement}
      const existsMatch = expr.match(/^(\w+):\+(.*)$/);
      if (existsMatch) {
        const [, varName, replacement] = existsMatch;
        return this.variables.has(varName) ? replacement : '';
      }

      // 简单变量
      const value = this.variables.get(expr.trim());
      return value ?? match; // 未找到则保留原样
    });
  }

  /**
   * 解析对象中的所有字符串值
   */
  resolveObject<T extends Record<string, unknown>>(obj: T): T {
    const result = { ...obj } as Record<string, unknown>;
    
    for (const [key, value] of Object.entries(result)) {
      if (typeof value === 'string') {
        result[key] = this.resolve(value);
      } else if (Array.isArray(value)) {
        result[key] = value.map(item => 
          typeof item === 'string' ? this.resolve(item) : item
        );
      } else if (value && typeof value === 'object') {
        result[key] = this.resolveObject(value as Record<string, unknown>);
      }
    }
    
    return result as T;
  }

  /** 变量自增 */
  increment(key: string, by: number = 1): number {
    const current = parseInt(this.variables.get(key) ?? '0', 10);
    const newValue = current + by;
    this.variables.set(key, String(newValue));
    return newValue;
  }

  /** 追加到变量（字符串拼接） */
  append(key: string, value: string, separator: string = ''): void {
    const current = this.variables.get(key) ?? '';
    this.variables.set(key, current + separator + value);
  }
}
