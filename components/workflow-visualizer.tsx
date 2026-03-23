'use client';

/**
 * 工作流流程可视化组件
 * 
 * 展示 RPA 工作流的执行步骤，风格与 publish 页面一致
 */

import { useState } from 'react';

export interface WorkflowStep {
  id: string;
  name: string;
  type: 'navigate' | 'click' | 'type' | 'upload' | 'wait' | 'condition' | 'emit';
  description?: string;
  selector?: string;
  params?: Record<string, unknown>;
  status?: 'pending' | 'running' | 'success' | 'error' | 'skip';
}

interface WorkflowVisualizerProps {
  title: string;
  steps: WorkflowStep[];
  currentStepId?: string;
  onStepClick?: (step: WorkflowStep) => void;
}

// 步骤类型图标
const STEP_ICONS: Record<string, string> = {
  navigate: '🧭',
  click: '👆',
  type: '⌨️',
  upload: '📤',
  wait: '⏳',
  condition: '🔀',
  emit: '📡',
};

// 步骤类型标签
const STEP_LABELS: Record<string, string> = {
  navigate: '导航',
  click: '点击',
  type: '输入',
  upload: '上传',
  wait: '等待',
  condition: '判断',
  emit: '通知',
};

export function WorkflowVisualizer({
  title,
  steps,
  currentStepId,
  onStepClick,
}: WorkflowVisualizerProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="bg-card border border-border rounded-xl shadow-sm">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">{title}</span>
          <span className="px-2 py-0.5 bg-primary/20 text-primary rounded-full text-xs">
            {steps.length} 步
          </span>
        </div>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="text-muted-foreground hover:text-foreground text-sm transition-colors"
        >
          {collapsed ? '展开' : '收起'}
        </button>
      </div>

      {/* 流程步骤 */}
      {!collapsed && (
        <div className="p-4">
          <div className="space-y-2">
            {steps.map((step, idx) => {
              const isCurrent = step.id === currentStepId;
              const icon = STEP_ICONS[step.type] || '⚡';
              const typeLabel = STEP_LABELS[step.type] || step.type;
              
              return (
                <div
                  key={step.id}
                  onClick={() => onStepClick?.(step)}
                  className={`group relative flex items-start gap-3 p-3 rounded-lg transition-all ${
                    isCurrent
                      ? 'bg-primary/10 border border-primary'
                      : 'bg-muted/30 border border-transparent hover:border-border'
                  } ${onStepClick ? 'cursor-pointer' : ''}`}
                >
                  {/* 步骤序号和连接线 */}
                  <div className="flex flex-col items-center flex-shrink-0">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium transition-colors ${
                      step.status === 'success' ? 'bg-green-600 text-white' :
                      step.status === 'error' ? 'bg-red-600 text-white' :
                      step.status === 'running' ? 'bg-primary text-white animate-pulse' :
                      isCurrent ? 'bg-primary text-white' :
                      'bg-muted text-muted-foreground'
                    }`}>
                      {step.status === 'success' ? '✓' :
                       step.status === 'error' ? '✕' :
                       step.status === 'running' ? '⋯' :
                       idx + 1}
                    </div>
                    {idx < steps.length - 1 && (
                      <div className={`w-px h-8 mt-1 ${
                        step.status === 'success' ? 'bg-green-600/40' : 'bg-border'
                      }`} />
                    )}
                  </div>

                  {/* 步骤内容 */}
                  <div className="flex-1 min-w-0 pt-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-base">{icon}</span>
                      <span className="text-sm font-medium text-foreground">{step.name}</span>
                      <span className="px-1.5 py-0.5 bg-muted text-muted-foreground rounded text-xs">
                        {typeLabel}
                      </span>
                    </div>
                    
                    {step.description && (
                      <p className="text-xs text-muted-foreground mt-1">{step.description}</p>
                    )}
                    
                    {step.selector && (
                      <code className="block text-xs text-primary/80 bg-primary/5 px-2 py-1 rounded mt-2 truncate">
                        {step.selector}
                      </code>
                    )}
                  </div>

                  {/* 状态指示 */}
                  {step.status && step.status !== 'pending' && (
                    <div className="flex-shrink-0 pt-1">
                      {step.status === 'running' && (
                        <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// 预设：抖音发布流程
export const DOUYIN_PUBLISH_WORKFLOW: WorkflowStep[] = [
  {
    id: 'start',
    name: '打开发布页面',
    type: 'navigate',
    description: '跳转到抖音创作者平台上传页',
    params: { url: 'https://creator.douyin.com/creator-micro/content/upload' },
  },
  {
    id: 'checkLogin',
    name: '检测登录状态',
    type: 'condition',
    description: '判断是否已登录，未登录则弹出二维码',
    selector: 'input[accept*="video/mp4"]',
  },
  {
    id: 'upload',
    name: '上传视频文件',
    type: 'upload',
    description: '选择并上传视频到抖音',
    selector: 'input[accept*="video/mp4"]',
  },
  {
    id: 'waitUpload',
    name: '等待上传完成',
    type: 'wait',
    description: '等待视频上传和转码完成（最多3分钟）',
    params: { timeout: 180000 },
  },
  {
    id: 'fillTitle',
    name: '填写标题',
    type: 'type',
    description: '输入视频标题（最多30字）',
    selector: '[class*="title"] input, [placeholder*="标题"]',
  },
  {
    id: 'fillDesc',
    name: '填写描述',
    type: 'type',
    description: '输入视频描述或正文内容',
    selector: '.editor-kit-editor-container',
  },
  {
    id: 'waitDetection',
    name: '等待内容检测',
    type: 'wait',
    description: '等待平台审核视频内容（约30秒）',
    params: { timeout: 120000 },
  },
  {
    id: 'clickPublish',
    name: '点击发布按钮',
    type: 'click',
    description: '点击"发布"按钮提交视频',
    selector: 'button:has-text("发布")',
  },
  {
    id: 'waitResult',
    name: '等待发布结果',
    type: 'wait',
    description: '等待发布成功提示',
    params: { timeout: 30000 },
  },
  {
    id: 'done',
    name: '发布完成',
    type: 'emit',
    description: '视频已提交抖音审核，等待平台审核通过',
  },
];
