import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const HISTORY_DIR = path.join(process.cwd(), '.publish-history');

// GET /api/publish/status?taskId=xxx
export async function GET(req: NextRequest) {
  const taskId = req.nextUrl.searchParams.get('taskId');

  // 不传 taskId 时返回最近 20 个任务列表
  if (!taskId) {
    if (!fs.existsSync(HISTORY_DIR)) return NextResponse.json([]);
    const dirs = fs.readdirSync(HISTORY_DIR)
      .filter(d => fs.existsSync(path.join(HISTORY_DIR, d, 'task.json')))
      .sort()
      .reverse()
      .slice(0, 20);

    const list = dirs.map(d => {
      try {
        const task = JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, d, 'task.json'), 'utf-8'));
        return {
          taskId: task.taskId,
          status: task.status,
          startTime: task.startTime,
          endTime: task.endTime,
          durationSec: task.durationSec,
          title: task.input?.title,
          result: task.result,
        };
      } catch { return null; }
    }).filter(Boolean);

    return NextResponse.json(list);
  }

  // 返回单个任务详情（含截图 URL）
  const taskDir = path.join(HISTORY_DIR, taskId);
  const taskFile = path.join(taskDir, 'task.json');
  if (!fs.existsSync(taskFile)) {
    return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  }

  const task = JSON.parse(fs.readFileSync(taskFile, 'utf-8'));

  // 把截图路径转为可访问的 URL
  if (Array.isArray(task.checkpoints)) {
    task.checkpoints = task.checkpoints.map((cp: { screenshot?: string; screenshotUrl?: string; [k: string]: unknown }) => {
      if (cp.screenshot) {
        // 如果已经是完整的 URL (OSS)，直接赋值给 screenshotUrl
        if (cp.screenshot.startsWith('http')) {
          cp.screenshotUrl = cp.screenshot;
        } else {
          // 否则生成本地 API 地址（兼容旧任务）
          cp.screenshotUrl = `/api/publish/screenshot/${taskId}/${cp.screenshot}`;
        }
      }
      return cp;
    });
  }

  // 找最新的 QR 码（状态接口优先使用 metadata 里的 OSS URL）
  if (task.latestQrUrl) {
    // 如果已经有 OSS URL，就不再生成 base64，减少体积
    if (!task.latestQrCode) {
      task.latestQrCode = task.latestQrUrl; 
    }
  } else {
    // 兼容逻辑：找本地最新的 QR 码截图（如果有）
    const screenshotDir = path.join(taskDir, 'screenshots');
    if (fs.existsSync(screenshotDir)) {
      const qrFiles = fs.readdirSync(screenshotDir)
        .filter(f => f.startsWith('qrcode-') && f.endsWith('.png'))
        .sort()
        .reverse();
      if (qrFiles.length > 0) {
        const latestQrFile = qrFiles[0];
        const qrBuf = fs.readFileSync(path.join(screenshotDir, latestQrFile));
        task.latestQrCode = `data:image/png;base64,${qrBuf.toString('base64')}`;
        task.latestQrUrl  = `/api/publish/screenshot/${taskId}/screenshots/${latestQrFile}`;
      }
    }
  }


  return NextResponse.json(task);
}
