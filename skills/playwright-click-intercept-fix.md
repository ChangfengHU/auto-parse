# Playwright 元素点击被拦截问题排查与修复

## 问题症状

### 典型错误信息
```
locator.click: Timeout 10000ms exceeded.
Call log:
  - element is visible, enabled and stable
  - scrolling into view if needed
  - done scrolling
  - <a aria-label="View media" href="/create/xxx" class="..."></a> intercepts pointer events
```

**关键标志**：`intercepts pointer events` - 说明目标元素被其他元素（通常是链接层）遮挡。

---

## 问题原因

1. **叠层结构**
   - 页面使用绝对定位布局，按钮上方覆盖了透明链接层
   - 鼠标悬停时按钮才会显示在最上层（z-index 变化）
   
2. **常见场景**
   - Meta AI 的 Download 按钮被 `<a aria-label="View media">` 拦截
   - Meta AI 的 Animate 按钮被同样的链接层拦截
   - 社交媒体平台的浮动操作按钮

---

## 解决方案

### 方案 1：使用 `force: true` 强制点击（快速方案）

**适用场景**：元素已经可见且位置正确，只是被其他元素遮挡

```typescript
// TypeScript 节点参数
interface ClickParams {
  selector: string
  force?: boolean  // ✅ 绕过点击检测
}

// Playwright 代码
await page.locator(selector).click({ force: true });
```

**工作流配置**：
```json
{
  "type": "click",
  "params": {
    "selector": ".grid > *:nth-child(2) button",
    "force": true  // ✅ 关键参数
  }
}
```

**优点**：快速简单
**缺点**：不会触发 hover 样式，可能影响某些交互逻辑

---

### 方案 2：使用 JavaScript 直接点击（推荐方案）

**适用场景**：需要完全绕过 Playwright 的点击检测

```typescript
// 在浏览器内执行 JS
await page.evaluate((selector) => {
  const btn = document.querySelector(selector);
  if (btn) {
    // 1. 触发父容器 hover 效果
    const container = btn.closest('div[class*="group"]') || btn.parentElement;
    if (container) {
      container.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      container.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    }
    // 2. 点击按钮
    (btn as HTMLElement).click();
  }
}, selector);
```

**优点**：完全控制，可触发 hover
**缺点**：需要额外代码

---

### 方案 3：先悬停容器再点击（模拟真实操作）

**适用场景**：需要严格模拟用户行为

```typescript
// 1. 滚动到视口
await page.evaluate((selector) => {
  const btn = document.querySelector(selector);
  if (btn) btn.scrollIntoView({ block: 'center', behavior: 'smooth' });
}, selector);

await page.waitForTimeout(500);

// 2. 触发 hover
await page.evaluate((selector) => {
  const btn = document.querySelector(selector);
  const container = btn?.closest('div') || btn?.parentElement;
  if (container) {
    container.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
  }
}, selector);

await page.waitForTimeout(300);

// 3. 点击
await page.locator(selector).click();
```

**优点**：最接近真实用户行为
**缺点**：代码较多，执行时间长

---

## 在本项目中的应用

### 1. Meta AI 下载按钮
**问题**：
```
page.$$('[aria-label="Download"]') 卡住
Download 按钮被 <a> 链接层拦截
```

**解决**：
```typescript
// lib/workflow/nodes/metaai-download.ts
// ✅ 使用 page.evaluate 查找 + JS 直接点击
const buttonData = await page.evaluate(() => {
  const btns = document.querySelectorAll('[aria-label="Download"]');
  return Array.from(btns).map((btn, i) => ({ index: i, ... }));
});

// 触发下载
await page.evaluate((index) => {
  const btn = document.querySelectorAll('[aria-label="Download"]')[index];
  // 1. 滚动到位置
  btn.scrollIntoView({ block: 'center', behavior: 'smooth' });
}, index);

await page.evaluate((index) => {
  const btn = document.querySelectorAll('[aria-label="Download"]')[index];
  // 2. 触发 hover
  const container = btn.closest('div') || btn.parentElement;
  container?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
}, index);

await page.evaluate((index) => {
  // 3. 点击
  const btn = document.querySelectorAll('[aria-label="Download"]')[index];
  (btn as HTMLElement).click();
}, index);
```

### 2. 点击节点增强
**文件**：`lib/workflow/nodes/click.ts`

**新增参数**：
```typescript
export interface ClickParams {
  selector?: string
  text?: string
  force?: boolean  // ✅ 新增：强制点击
}
```

**使用**：
```typescript
await locator.click({ 
  timeout: 10000,
  force: params.force ?? false  // ✅ 支持强制点击
});
```

---

## 诊断流程

1. **查看错误日志**
   - 是否包含 `intercepts pointer events`？
   - 是哪个元素拦截了？（通常是 `<a>` 或 `<div>`）

2. **检查页面结构**
   ```typescript
   // 分析 DOM 层级
   const structure = await page.evaluate((selector) => {
     const btn = document.querySelector(selector);
     let current = btn;
     const parents = [];
     for (let i = 0; i < 5 && current; i++) {
       parents.push({
         tag: current.tagName,
         classes: current.className,
         zIndex: window.getComputedStyle(current).zIndex
       });
       current = current.parentElement;
     }
     return parents;
   }, selector);
   console.log(structure);
   ```

3. **验证选择器**
   ```typescript
   // 确认元素可见
   const isVisible = await page.evaluate((sel) => {
     const el = document.querySelector(sel);
     if (!el) return false;
     const rect = el.getBoundingClientRect();
     return rect.width > 0 && rect.height > 0;
   }, selector);
   ```

4. **尝试解决方案**
   - 先试 `force: true`（最快）
   - 不行就用 JS 直接点击
   - 最后考虑完整的 hover + click 流程

---

## 常见错误与避免

### ❌ 错误做法 1：重复调用 Playwright API
```typescript
// 卡住原因：page.$$ 在某些情况下会卡住
const buttons = await page.$$('[aria-label="Download"]');
for (const btn of buttons) {
  await btn.click(); // 可能被拦截
}
```

### ✅ 正确做法：用 evaluate 在浏览器内操作
```typescript
const buttons = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('[aria-label="Download"]')).length;
});

for (let i = 0; i < buttons; i++) {
  await page.evaluate((index) => {
    const btn = document.querySelectorAll('[aria-label="Download"]')[index];
    btn.scrollIntoView({ block: 'center' });
  }, i);
  // ... 继续操作
}
```

---

### ❌ 错误做法 2：使用 Playwright 专有选择器在 evaluate 中
```typescript
// ❌ 错误：:has-text() 只在 Playwright 中有效
await page.evaluate(() => {
  const btn = document.querySelector('button:has-text("Animate")'); // SyntaxError!
});
```

### ✅ 正确做法：使用标准 DOM API
```typescript
// ✅ 正确：使用标准 API
await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll('button'));
  const animateBtn = buttons.find(b => b.textContent?.includes('Animate'));
});
```

---

## 总结

| 问题 | 症状 | 快速修复 | 根本解决 |
|------|------|----------|----------|
| 元素被拦截 | `intercepts pointer events` | `force: true` | JS 直接点击 |
| API 卡住 | `page.$$()` 无响应 | 改用 `page.evaluate()` | - |
| 选择器错误 | `:has-text()` 语法错误 | 用标准 DOM API | - |
| 按钮不可见 | Y 坐标为负数 | `scrollIntoView()` | - |

**最佳实践**：
1. 优先使用 `page.evaluate()` 在浏览器内操作
2. 遇到拦截先试 `force: true`
3. 需要精确控制时用 JS 直接点击
4. 记录选择器生成逻辑，避免硬编码索引

---

## 2026-04 最新实战修复（Meta AI Animate）

### 新增稳定策略

1. `click` 节点默认对 CSS 选择器增加 `:visible` 过滤，避免匹配到隐藏按钮。
2. 若 `locator.click()` 报 `intercepts pointer events`，自动回退为 `locator.evaluate(el => el.click())`。
3. `click` 节点支持 `force: true` 参数，工作流可直接强制点击。
4. `metaai_download` 返回可复用映射（按卡片容器关联，不再全局匹配）：
   - `id`
   - `animateSelector`（`button:has-text("Animate")`）
   - `animateNth`（第几个可见 Animate）
   - `ossUrl`
5. `id` 优先从卡片内链接提取：`a[aria-label="View media"][href*="/create/"]` → `/create/{id}`，避免 `unknown`。

### 推荐工作流写法

点击节点使用：

```json
{
  "useSelector": true,
  "selector": "{{metaaiImages[1].animateSelector}}",
  "nth": "{{metaaiImages[1].animateNth}}",
  "force": true
}
```

### 根因结论

不是“按钮不存在”，而是 **同一选择器匹配多个元素（含隐藏项）+ 透明链接层拦截点击**。  
通过“可见过滤 + nth 精确定位 + 拦截自动回退 + force 兜底”可稳定解决。
