'use client';

/**
 * 步骤列表组件
 * 
 * 显示工作流中的所有步骤，支持选择、排序、删除
 */

import { ActionStep } from '@/lib/rpa/types';

export interface StepListProps {
  steps: ActionStep[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, direction: 'up' | 'down') => void;
  onDuplicate: (id: string) => void;
  actionLabels: Record<string, string>;
}

// 动作类型对应的图标
const ACTION_ICONS: Record<string, string> = {
  navigate: '🧭',
  click: '👆',
  type: '⌨️',
  clear: '🧹',
  press: '⏎',
  hover: '🖱️',
  select: '📋',
  check: '☑️',
  uncheck: '☐',
  upload: '📤',
  download: '📥',
  waitForSelector: '👁️',
  waitForText: '📝',
  waitForHidden: '🙈',
  waitForUrl: '🔗',
  waitForNavigation: '🚦',
  sleep: '💤',
  captureQR: '📱',
  screenshot: '📸',
  extractText: '📄',
  extractAttribute: '🏷️',
  waitForLogin: '🔐',
  extractCookie: '🍪',
  injectCookie: '💉',
  condition: '🔀',
  loop: '🔄',
  break: '⏹️',
  continue: '⏭️',
  goto: '↗️',
  setVariable: '📊',
  emit: '📡',
  log: '📝',
};

export function StepList({
  steps,
  selectedId,
  onSelect,
  onDelete,
  onMove,
  onDuplicate,
  actionLabels,
}: StepListProps) {
  if (steps.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-500 p-8">
        <div className="text-4xl mb-4">📋</div>
        <p className="text-sm text-center">
          暂无步骤
          <br />
          <span className="text-gray-600">从左侧面板添加节点</span>
        </p>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-gray-300">
          工作流步骤 ({steps.length})
        </h3>
      </div>
      
      <div className="space-y-2">
        {steps.map((step, idx) => {
          const isSelected = step.id === selectedId;
          const icon = ACTION_ICONS[step.type] || '⚡';
          
          return (
            <div
              key={step.id}
              onClick={() => onSelect(step.id)}
              className={`group relative p-3 rounded-lg border cursor-pointer transition-all ${
                isSelected
                  ? 'bg-pink-500/10 border-pink-500'
                  : 'bg-gray-800/50 border-gray-700 hover:border-gray-600'
              }`}
            >
              {/* 步骤序号 */}
              <div className="absolute -left-0.5 top-1/2 -translate-y-1/2 w-6 h-6 bg-gray-800 border border-gray-700 rounded-full flex items-center justify-center text-xs text-gray-400">
                {idx + 1}
              </div>
              
              {/* 连接线 */}
              {idx < steps.length - 1 && (
                <div className="absolute left-2.5 top-full w-px h-2 bg-gray-700" />
              )}
              
              <div className="ml-6 flex items-start gap-2">
                {/* 图标 */}
                <span className="text-lg flex-shrink-0">{icon}</span>
                
                {/* 内容 */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">
                    {step.name}
                  </p>
                  <p className="text-xs text-gray-500 truncate">
                    {actionLabels[step.type] || step.type}
                    {step.params?.selector && (
                      <span className="text-gray-600 ml-1">
                        · {truncateSelector(String(step.params.selector))}
                      </span>
                    )}
                  </p>
                </div>
                
                {/* 操作按钮 */}
                <div className={`flex items-center gap-1 ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}>
                  <button
                    onClick={(e) => { e.stopPropagation(); onMove(step.id, 'up'); }}
                    disabled={idx === 0}
                    className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-700 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                    title="上移"
                  >
                    ↑
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onMove(step.id, 'down'); }}
                    disabled={idx === steps.length - 1}
                    className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-700 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                    title="下移"
                  >
                    ↓
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDuplicate(step.id); }}
                    className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-700 rounded"
                    title="复制"
                  >
                    📋
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDelete(step.id); }}
                    className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded"
                    title="删除"
                  >
                    🗑️
                  </button>
                </div>
              </div>
              
              {/* 流程跳转指示 */}
              {(step.onSuccess || step.onFail) && (
                <div className="ml-6 mt-2 flex gap-2 text-xs">
                  {step.onSuccess && (
                    <span className="px-1.5 py-0.5 bg-green-500/20 text-green-400 rounded">
                      成功 → {step.onSuccess}
                    </span>
                  )}
                  {step.onFail && (
                    <span className="px-1.5 py-0.5 bg-red-500/20 text-red-400 rounded">
                      失败 → {step.onFail}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function truncateSelector(selector: string): string {
  if (selector.length <= 30) return selector;
  return selector.slice(0, 27) + '...';
}
