/**
 * RPA 工作流管理 API
 * 
 * GET /api/rpa/workflows - 获取可用工作流列表
 * POST /api/rpa/workflows - 保存工作流
 */

import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

const WORKFLOWS_DIR = path.join(process.cwd(), 'lib/rpa/workflows');

export async function GET() {
  try {
    // 确保目录存在
    if (!fs.existsSync(WORKFLOWS_DIR)) {
      fs.mkdirSync(WORKFLOWS_DIR, { recursive: true });
    }
    
    const files = fs.readdirSync(WORKFLOWS_DIR).filter(f => f.endsWith('.json'));
    
    const workflows = files.map(file => {
      const content = fs.readFileSync(path.join(WORKFLOWS_DIR, file), 'utf-8');
      const w = JSON.parse(content);
      return {
        id: w.id,
        name: w.name,
        platform: w.platform,
        version: w.version,
        description: w.description,
        stepsCount: w.steps?.length ?? 0,
        variables: Object.keys(w.variables ?? {}),
      };
    });

    return NextResponse.json({
      workflows,
      total: workflows.length,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const workflow = await req.json();
    
    if (!workflow.id || !workflow.name) {
      return NextResponse.json(
        { error: '工作流必须包含 id 和 name' },
        { status: 400 }
      );
    }
    
    // 确保目录存在
    if (!fs.existsSync(WORKFLOWS_DIR)) {
      fs.mkdirSync(WORKFLOWS_DIR, { recursive: true });
    }
    
    // 生成安全的文件名
    const filename = `${workflow.id.replace(/[^a-zA-Z0-9-_]/g, '-')}.json`;
    const filepath = path.join(WORKFLOWS_DIR, filename);
    
    // 保存工作流
    fs.writeFileSync(filepath, JSON.stringify(workflow, null, 2), 'utf-8');
    
    return NextResponse.json({
      success: true,
      id: workflow.id,
      path: filepath,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
