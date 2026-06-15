# Playwright chrome-headless-shell 进程泄漏

## 现象

长时间运行后，`chrome-headless-shell` 进程数量持续增长（实测达到 530+），导致：

- 内存耗尽（8GB 机器 swap 打满）
- 负载飙升（load average 12+）
- 生图任务频繁超时（>45min）、Gemini 浏览器操作极慢

**注意：早期曾误判为 AdsPower tab 堆积，实际是 Playwright headless 进程，两者用不同 grep 区分：**

```bash
# Playwright 孤儿进程（真正的问题）
ps aux | grep '[c]hrome-headless-shell' | wc -l

# AdsPower 浏览器进程（正常，3个分身约 50 个）
ps aux | grep '[S]unBrowser' | wc -l
```

## 根本原因

`workflow-task-cli.ts` 的 `startWorkflowAsync`：

1. 任务启动时创建 `placeholderBrowser = chromium.launch({ headless: true })`（占位浏览器）
2. AdsPower `navigate` 节点触发时，runtime 的 `browser` 字段被替换为 AdsPower CDP 浏览器
3. **旧的 `placeholderBrowser` 没有被关闭**，变成孤儿进程
4. 每次任务失败重试都会产生一个新的孤儿，大量并发任务 + watchdog 强杀导致爆发式增长

## 修复

在 `updateTaskRuntime` 中，替换 browser 引用前先关闭旧的：

```typescript
if (patch.browser !== undefined && patch.browser !== current.browser && current.browser) {
  current.browser.close().catch(() => {});
}
```

已在 `lib/workflow/workflow-task-cli.ts` 的 `updateTaskRuntime` 函数中修复。

## 应急清理命令

如发现机器负载异常，先检查：

```bash
# 检查数量
ps aux | grep '[c]hrome-headless-shell' | wc -l

# 清理孤儿进程（不影响 AdsPower 和 Next.js）
ps aux | grep '[c]hrome-headless-shell' | awk '{print $2}' | xargs -r kill -9
```

## 监控建议

定期检查，超过 20 个即异常：

```bash
ps aux | grep '[c]hrome-headless-shell' | wc -l
```
