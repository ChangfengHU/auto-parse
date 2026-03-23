import type { WorkflowDef } from '../types';

/**
 * 抖音视频发布工作流
 *
 * 变量：
 *   videoUrl  — 视频 OSS URL
 *   title     — 视频标题（支持 #话题标签）
 *
 * 流程：
 *   1.  导航到抖音创作者首页
 *   2.  检测登录状态 → 未登录则弹出二维码扫码
 *   3.  导航到视频上传页
 *   4.  上传视频文件（URL → 下载 → 注入 input）
 *   5.  等待页面跳转到填写信息页
 *   6.  填写标题
 *   7.  滚动到页面底部（让发布按钮进入视口）
 *   8.  等待内容安全检测通过
 *   9.  点击发布
 *  10.  等待跳转到作品管理页
 *  11.  截图留存
 */
export const douyinPublishWorkflow: WorkflowDef = {
  id: 'douyin-publish',
  name: '抖音视频发布',
  description: '上传视频到抖音创作者平台并发布',
  vars: ['videoUrl', 'title'],

  nodes: [
    // ── Step 1：打开创作者首页 ───────────────────────────────────────────
    {
      type: 'navigate',
      label: '打开创作者首页',
      params: {
        url: 'https://creator.douyin.com',
        waitUntil: 'domcontentloaded',
      },
    },

    // ── Step 2：检测登录状态 ──────────────────────────────────────────────
    // 已登录 → 立即通过；未登录 → 截图二维码等待扫码
    {
      type: 'qrcode',
      label: '检测登录状态（未登录则扫码）',
      params: {
        successUrlContains: 'creator-micro',
        excludeUrls: ['/login', 'qrcode', 'passport'],
        cookieDomain: 'douyin.com',
        timeout: 300_000,
        refreshInterval: 110_000,
      },
    },

    // ── Step 3：导航到视频上传页 ─────────────────────────────────────────
    {
      type: 'navigate',
      label: '导航到视频上传页',
      params: {
        url: 'https://creator.douyin.com/creator-micro/content/upload',
        waitUntil: 'domcontentloaded',
      },
    },

    // ── Step 4：上传视频文件 ──────────────────────────────────────────────
    {
      type: 'file_upload',
      label: '上传视频文件',
      params: {
        selector: 'input[accept*="video/mp4"], input[accept*="video"], input[type="file"]',
        url: '{{videoUrl}}',
      },
    },

    // ── Step 5：等待页面跳转到填写信息页 ─────────────────────────────────
    {
      type: 'wait_condition',
      label: '等待跳转到填写信息页',
      params: {
        urlContains: 'content/post',
        timeout: 120_000,
        timeoutAction: 'continue',
      },
    },

    // ── Step 6：填写标题 ──────────────────────────────────────────────────
    {
      type: 'text_input',
      label: '填写标题',
      params: {
        selector: '.zone-container',
        value: '{{title}}',
      },
    },

    // ── Step 7：滚动到页面底部（让发布按钮进入视口）─────────────────────
    {
      type: 'scroll',
      label: '滚动到页面底部',
      params: {
        y: 800,
        behavior: 'smooth',
      },
    },

    // ── Step 8：等待内容安全检测 ──────────────────────────────────────────
    {
      type: 'wait_condition',
      label: '等待内容检测',
      params: {
        textMatch: '检测中\\s*(\\d+)\\s*%',
        condition: 'value > 94',
        timeout: 180_000,
        timeoutAction: 'continue',
        pollInterval: 2_000,
        failKeywords: ['违规', '无法发布', '检测失败', '审核不通过', '发布失败', '不符合', '风险', '限流'],
        successKeywords: ['作品未见异常', '检测通过', '内容正常', '未见风险'],
        verifyButtonText: '发布',
      },
    },

    // ── Step 9：点击发布按钮 ──────────────────────────────────────────────
    {
      type: 'click',
      label: '点击发布',
      params: {
        text: '发布',
      },
    },

    // ── Step 10：等待跳转到作品管理页 ────────────────────────────────────
    {
      type: 'wait_condition',
      label: '等待发布完成',
      params: {
        urlContains: '/content/manage',
        timeout: 60_000,
        timeoutAction: 'fail',
      },
    },

    // ── Step 11：截图留存 ─────────────────────────────────────────────────
    {
      type: 'screenshot',
      label: '发布成功截图',
      params: {},
    },
  ],
};
