import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import type { Page } from 'playwright';
import { uploadFromFile } from '@/lib/oss';
import type { NodeResult, WorkflowContext, MetaAIGenerateParams } from '../types';

const execAsync = promisify(exec);

export async function executeMetaAIGenerate(
  page: Page,
  params: MetaAIGenerateParams,
  ctx: WorkflowContext
): Promise<NodeResult> {
  const log: string[] = [];
  const outputVar = params.outputVar || 'metaaiVideos';
  const prompt = params.prompt; 

  try {
    log.push(`🎨 开始通过 Python 脚本调用 Meta AI 生成: "${prompt}"`);
    
    // 获取 doouyin 项目的绝对路径
    const projectRoot = process.cwd();
    const scriptPath = path.join(projectRoot, 'scripts', 'metaai_generate.py');
    
    // 执行 Python 脚本 (传入 --json 让它吐出 JSON 数据)
    // 利用 uv run <script> 触发自动拉取行内要求的 requests 和 playwright 依赖
    const cmd = `uv run "${scriptPath}" --prompt "${prompt}" --json`;
    log.push(`🚀 运行底层脚本: ${cmd}`);

    // Meta AI 渲染视频通常需要较长时间，超时放宽到 3 分钟 (180000ms) 以上
    const { stdout, stderr } = await execAsync(cmd, { timeout: 240_000, cwd: projectRoot });
    
    // 解析最后一行的 JSON 输出
    const lines = stdout.trim().split('\n');
    const lastLine = lines[lines.length - 1];
    let result;
    try {
      result = JSON.parse(lastLine);
    } catch (e) {
      throw new Error(`无法解析 Python 输出 JSON: ${lastLine}\nstderr: ${stderr}`);
    }

    if (result.error) {
      throw new Error(`Python脚本报错返回: ${result.error}`);
    }

    const files: string[] = result.files || [];
    if (files.length === 0) {
      throw new Error('Meta AI 未返回任何生成的文件路径');
    }

    log.push(`✅ 成功在本地生成 ${files.length} 个结果文件，开始上传至 OSS...`);

    const ossUrls: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!fs.existsSync(file)) {
        log.push(`⚠️ 找不到生成的文件: ${file}`);
        continue;
      }
      
      const ext = path.extname(file) || '.mp4';
      const ossKey = `metaai/${Date.now()}_${i}${ext}`;
      
      try {
        log.push(`  ⬆️ 正在上传: ${path.basename(file)}`);
        // 调用 doouyin 项目现有的 OSS 上传模块
        const url = await uploadFromFile(file, ossKey);
        ossUrls.push(url);
        log.push(`  ☁️ 上传成功 [${i + 1}/${files.length}]: ${url}`);
        
        // 可选：上传完清理本地防撑爆硬盘
        fs.unlinkSync(file);
      } catch (upErr) {
        log.push(`  ❌ 上传 OSS 失败 [${i + 1}]: ${String(upErr)}`);
      }
    }

    // 将上传结果塞进当前工作流运行上下文，要求变量值为 string，所以这里存成 JSON
    ctx.vars[outputVar] = JSON.stringify(ossUrls);
    log.push(`🎉 节点执行完毕，OSS 数组已存入变量 [${outputVar}]`);

    return { 
      success: true, 
      log, 
      output: { [outputVar]: ossUrls } 
    };

  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    log.push(`❌ Meta AI 生成节点失败: ${errorMsg}`);
    return { success: false, log, error: errorMsg };
  }
}
