/**
 * 单个工作流 API
 * 
 * GET /api/rpa/workflows/[id] - 获取工作流详情
 * PUT /api/rpa/workflows/[id] - 更新工作流
 * DELETE /api/rpa/workflows/[id] - 删除工作流
 */

import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

const WORKFLOWS_DIR = path.join(process.cwd(), 'lib/rpa/workflows');

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(
  _req: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params;
    
    // 查找工作流文件
    const filename = `${id}.json`;
    const filepath = path.join(WORKFLOWS_DIR, filename);
    
    if (!fs.existsSync(filepath)) {
      return NextResponse.json(
        { error: '工作流不存在' },
        { status: 404 }
      );
    }
    
    const content = fs.readFileSync(filepath, 'utf-8');
    const workflow = JSON.parse(content);
    
    return NextResponse.json({ workflow });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params;
    const workflow = await req.json();
    
    // 确保 ID 一致
    workflow.id = id;
    
    const filename = `${id}.json`;
    const filepath = path.join(WORKFLOWS_DIR, filename);
    
    fs.writeFileSync(filepath, JSON.stringify(workflow, null, 2), 'utf-8');
    
    return NextResponse.json({
      success: true,
      id,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params;
    
    const filename = `${id}.json`;
    const filepath = path.join(WORKFLOWS_DIR, filename);
    
    if (!fs.existsSync(filepath)) {
      return NextResponse.json(
        { error: '工作流不存在' },
        { status: 404 }
      );
    }
    
    fs.unlinkSync(filepath);
    
    return NextResponse.json({
      success: true,
      id,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
