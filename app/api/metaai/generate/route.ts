import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { uploadFromFile } from '@/lib/oss';

const execAsync = promisify(exec);

export const maxDuration = 300; // 最长允许 5 分钟超时，因为 Meta AI 视频渲染要时间

export async function POST(req: NextRequest) {
  try {
    const { prompt } = await req.json();

    if (!prompt) {
      return NextResponse.json({ error: '必须提供 Prompt' }, { status: 400 });
    }

    console.log(`[Meta AI] 收到生成请求: ${prompt}`);

    const projectRoot = process.cwd();
    const scriptPath = path.join(projectRoot, 'scripts', 'metaai_generate.py');
    
    const cmd = `uv run "${scriptPath}" --prompt "${prompt}" --json`;
    console.log(`[Meta AI] 执行命令: ${cmd}`);

    const { stdout, stderr } = await execAsync(cmd, { timeout: 280_000, cwd: projectRoot });

    const lines = stdout.trim().split('\n');
    const lastLine = lines[lines.length - 1];
    
    let result;
    try {
      result = JSON.parse(lastLine);
    } catch (e) {
      console.error('[Meta AI] Python 输出解析失败:', lastLine, stderr);
      return NextResponse.json({ error: 'Python 输出解析错误' }, { status: 500 });
    }

    if (result.error) {
      return NextResponse.json({ error: `底层由于 AdsPower 或网络报错: ${result.error}` }, { status: 500 });
    }

    const files: string[] = result.files || [];
    if (files.length === 0) {
      return NextResponse.json({ error: 'Meta AI 未生出内容或被敏感词拦截' }, { status: 500 });
    }

    console.log(`[Meta AI] 获取到 ${files.length} 个本地结果，正在上传 OSS...`);

    const ossUrls: string[] = [];
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!fs.existsSync(file)) continue;

        const ext = path.extname(file) || '.mp4';
        const ossKey = `metaai/${Date.now()}_${i}${ext}`;
        try {
            const url = await uploadFromFile(file, ossKey);
            ossUrls.push(url);
            console.log(`[Meta AI] 上传到 OSS 成功: ${url}`);
            fs.unlinkSync(file); // 上传完删掉本地的以节约空间
        } catch (e) {
            console.error(`[Meta AI] 上传 OSS 失败: ${e}`);
        }
    }

    return NextResponse.json({ success: true, urls: ossUrls });

  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    console.error('[Meta AI] 全局异常:', error);
    return NextResponse.json({ error: `执行异常: ${message}` }, { status: 500 });
  }
}
