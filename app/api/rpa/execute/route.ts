/**
 * RPA 工作流执行 API
 * 
 * POST /api/rpa/execute - 执行工作流（SSE 流式）
 * 
 * 这是独立于现有发布流程的新 API，不影响 /api/publish
 */

import { NextRequest } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// 动态导入以避免模块解析问题
const getPersistentContext = async () => {
  const mod = await import('@/lib/persistent-browser');
  return mod.getPersistentContext();
};

const loadRPAEngine = async () => {
  const mod = await import('@/lib/rpa/engine');
  return mod.RPAEngine;
};

const loadWorkflow = async (id: string) => {
  const workflowPath = path.join(process.cwd(), 'lib/rpa/workflows', `${id}.json`);
  const content = fs.readFileSync(workflowPath, 'utf-8');
  return JSON.parse(content);
};

type Workflow = {
  id: string;
  name: string;
  platform: string;
  version: string;
  description?: string;
  variables: Record<string, string>;
  steps: unknown[];
};

type EmitFn = (type: string, payload: string) => void;

const AVAILABLE_WORKFLOWS = ['douyin-publish'];

// 简单的任务锁（防止并发）
let currentTask: string | null = null;

/**
 * POST /api/rpa/execute
 * 
 * Body:
 * {
 *   workflowId?: string,      // 内置工作流 ID（如 'douyin-publish'）
 *   workflow?: Workflow,       // 或直接传入工作流配置
 *   variables?: Record<string, string>,  // 运行时变量
 * }
 * 
 * 返回 SSE 流式事件
 */
export async function POST(req: NextRequest) {
  // 检查是否有任务在运行
  if (currentTask) {
    return new Response(
      JSON.stringify({ error: `已有任务在运行中: ${currentTask}` }),
      { status: 409, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const body = await req.json().catch(() => ({}));
  const { workflowId, workflow: customWorkflow, variables = {} } = body as {
    workflowId?: string;
    workflow?: Workflow;
    variables?: Record<string, string>;
  };

  // 获取工作流配置
  let workflow: Workflow | null = null;

  if (customWorkflow) {
    workflow = customWorkflow;
  } else if (workflowId && AVAILABLE_WORKFLOWS.includes(workflowId)) {
    try {
      workflow = await loadWorkflow(workflowId);
    } catch (e) {
      return new Response(
        JSON.stringify({ error: `加载工作流失败: ${e}` }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  } else {
    return new Response(
      JSON.stringify({ 
        error: '请提供 workflowId 或 workflow 参数',
        availableWorkflows: AVAILABLE_WORKFLOWS,
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // 验证必要变量
  if (workflow!.id === 'douyin-publish') {
    if (!variables.videoPath && !variables.videoUrl) {
      return new Response(
        JSON.stringify({ error: '抖音发布需要 videoPath 或 videoUrl 参数' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (!variables.title) {
      return new Response(
        JSON.stringify({ error: '抖音发布需要 title 参数' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  // 如果提供的是 videoUrl，需要先下载
  if (variables.videoUrl && !variables.videoPath) {
    // 稍后在流程中处理
  }

  const encoder = new TextEncoder();
  const taskId = `rpa_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  currentTask = taskId;

  const stream = new ReadableStream({
    async start(controller) {
      const send: EmitFn = (type, payload) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type, payload })}\n\n`)
          );
        } catch {
          // 客户端断开
        }
      };

      let page: import('playwright').Page | null = null;

      try {
        send('log', `🆔 任务 ID: ${taskId}`);
        send('log', `📋 工作流: ${workflow!.name} (${workflow!.id})`);
        send('taskId', taskId);

        // 如果需要下载视频
        if (variables.videoUrl && !variables.videoPath) {
          send('log', '⏳ 开始下载视频...');
          const tmpPath = await downloadVideo(variables.videoUrl, send);
          variables.videoPath = tmpPath;
          send('log', '✅ 视频下载完成');
        }

        // 获取持久化浏览器
        send('log', '🚀 连接持久化浏览器...');
        const context = await getPersistentContext();
        page = await context.newPage();
        
        // 自动处理对话框
        page.on('dialog', d => d.accept());

        send('log', '✅ 浏览器已就绪');

        // 创建 RPA 引擎并执行
        const RPAEngine = await loadRPAEngine();
        const engine = new RPAEngine(page, workflow! as any, send, {
          debug: true,
          screenshotOnError: true,
          defaultTimeout: 30000,
        });

        // 注入变量
        engine.setVariables(variables);

        // 执行工作流
        const result = await engine.run();

        // 发送结果
        if (result.success) {
          send('done', JSON.stringify({
            success: true,
            message: '工作流执行成功',
            taskId,
            stepsExecuted: result.stepsExecuted,
            duration: result.duration,
          }));
        } else {
          send('error', result.error ?? '工作流执行失败');
        }

      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        send('error', `执行异常: ${errorMsg}`);
      } finally {
        // 清理
        currentTask = null;
        if (page) {
          await page.close().catch(() => {});
        }
        // 清理临时视频文件
        if (variables.videoPath?.includes(os.tmpdir())) {
          fs.unlink(variables.videoPath, () => {});
        }
        try {
          controller.close();
        } catch {
          // 已关闭
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  });
}

/**
 * 下载视频到临时目录
 */
async function downloadVideo(url: string, emit: EmitFn): Promise<string> {
  const axios = (await import('axios')).default;
  const tmpPath = path.join(os.tmpdir(), `rpa-video-${Date.now()}.mp4`);

  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 180000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    },
    onDownloadProgress: (progressEvent) => {
      if (progressEvent.total) {
        const percent = Math.round((progressEvent.loaded / progressEvent.total) * 100);
        if (percent % 20 === 0) {
          emit('log', `📥 下载进度: ${percent}%`);
        }
      }
    },
  });

  fs.writeFileSync(tmpPath, Buffer.from(response.data));
  return tmpPath;
}

/**
 * GET /api/rpa/execute - 获取当前任务状态
 */
export async function GET() {
  return Response.json({
    running: !!currentTask,
    taskId: currentTask,
  });
}
