'use client';

/**
 * RPA 可视化工作流编辑器
 * 
 * 功能：
 * 1. 可视化编排工作流节点
 * 2. 配置每个节点的选择器、参数
 * 3. 测试单个节点或整个流程
 * 4. 保存/加载工作流配置
 */

import { useState, useEffect, useCallback } from 'react';
import { StepEditor } from './step-editor';
import { StepList } from './step-list';
import { WorkflowRunner } from './workflow-runner';
import { ActionStep, Workflow, ActionType } from '@/lib/rpa/types';

// 内置节点类型
const ACTION_CATEGORIES = {
  navigation: {
    label: '导航',
    icon: '🧭',
    types: ['navigate', 'waitForUrl', 'reload', 'goBack'] as ActionType[],
  },
  interaction: {
    label: '交互',
    icon: '👆',
    types: ['click', 'type', 'fill', 'clear', 'press', 'hover', 'select', 'check', 'uncheck'] as ActionType[],
  },
  file: {
    label: '文件',
    icon: '📁',
    types: ['upload', 'screenshot'] as ActionType[],
  },
  wait: {
    label: '等待',
    icon: '⏳',
    types: ['waitFor', 'waitForHidden', 'waitForEnabled', 'sleep'] as ActionType[],
  },
  capture: {
    label: '捕获',
    icon: '📷',
    types: ['captureQR', 'screenshotElement', 'extractText', 'extractAttr'] as ActionType[],
  },
  login: {
    label: '登录',
    icon: '🔐',
    types: ['waitForLogin', 'extractCookie', 'injectCookie', 'checkLogin'] as ActionType[],
  },
  flow: {
    label: '流程',
    icon: '🔀',
    types: ['condition', 'loop', 'break', 'continue', 'goto', 'exit'] as ActionType[],
  },
  data: {
    label: '数据',
    icon: '📊',
    types: ['setVariable', 'emit', 'log'] as ActionType[],
  },
};

const ACTION_LABELS: Record<string, string> = {
  navigate: '页面跳转',
  click: '点击元素',
  type: '输入文本',
  fill: '填充输入',
  clear: '清空输入',
  press: '按键操作',
  hover: '鼠标悬停',
  select: '下拉选择',
  check: '勾选框',
  uncheck: '取消勾选',
  upload: '上传文件',
  waitFor: '等待元素',
  waitForHidden: '等待消失',
  waitForEnabled: '等待可用',
  waitForUrl: '等待跳转',
  reload: '刷新页面',
  goBack: '后退',
  sleep: '延时等待',
  captureQR: '捕获二维码',
  screenshot: '截图',
  screenshotElement: '元素截图',
  extractText: '提取文本',
  extractAttr: '提取属性',
  waitForLogin: '等待登录',
  extractCookie: '提取Cookie',
  injectCookie: '注入Cookie',
  checkLogin: '检查登录',
  condition: '条件分支',
  loop: '循环执行',
  break: '跳出循环',
  continue: '继续循环',
  goto: '跳转步骤',
  exit: '退出工作流',
  setVariable: '设置变量',
  emit: '发送事件',
  log: '记录日志',
};

export interface RPAEditorProps {
  /** 初始工作流 */
  initialWorkflow?: Workflow;
  /** 工作流变更回调 */
  onWorkflowChange?: (workflow: Workflow) => void;
  /** 可用变量（从外部传入） */
  externalVariables?: Record<string, string>;
}

export function RPAEditor({
  initialWorkflow,
  onWorkflowChange,
  externalVariables = {},
}: RPAEditorProps) {
  // 工作流状态
  const [workflow, setWorkflow] = useState<Workflow>(
    initialWorkflow || createEmptyWorkflow()
  );
  
  // 编辑状态
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'edit' | 'run' | 'json'>('edit');
  const [isDirty, setIsDirty] = useState(false);
  
  // 可用工作流列表
  const [workflows, setWorkflows] = useState<Array<{ id: string; name: string }>>([]);
  const [loadingWorkflows, setLoadingWorkflows] = useState(true);

  // 加载可用工作流
  useEffect(() => {
    fetch('/api/rpa/workflows')
      .then(r => r.json())
      .then(d => {
        setWorkflows(d.workflows || []);
        setLoadingWorkflows(false);
      })
      .catch(() => setLoadingWorkflows(false));
  }, []);

  // 选中的步骤
  const selectedStep = workflow.steps.find(s => s.id === selectedStepId) || null;

  // 更新工作流
  const updateWorkflow = useCallback((updates: Partial<Workflow>) => {
    setWorkflow(prev => {
      const next = { ...prev, ...updates };
      onWorkflowChange?.(next);
      setIsDirty(true);
      return next;
    });
  }, [onWorkflowChange]);

  // 更新步骤
  const updateStep = useCallback((stepId: string, updates: Partial<ActionStep>) => {
    setWorkflow(prev => ({
      ...prev,
      steps: prev.steps.map(s =>
        s.id === stepId ? { ...s, ...updates } : s
      ),
    }));
    setIsDirty(true);
  }, []);

  // 添加步骤
  const addStep = useCallback((type: ActionType, afterId?: string) => {
    const newStep: ActionStep = {
      id: `step_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      name: ACTION_LABELS[type] || type,
      type: type,
      params: getDefaultParams(type),
    };

    setWorkflow(prev => {
      const steps = [...prev.steps];
      if (afterId) {
        const idx = steps.findIndex(s => s.id === afterId);
        steps.splice(idx + 1, 0, newStep);
      } else {
        steps.push(newStep);
      }
      return { ...prev, steps };
    });
    
    setSelectedStepId(newStep.id);
    setIsDirty(true);
  }, []);

  // 删除步骤
  const deleteStep = useCallback((stepId: string) => {
    setWorkflow(prev => ({
      ...prev,
      steps: prev.steps.filter(s => s.id !== stepId),
    }));
    if (selectedStepId === stepId) {
      setSelectedStepId(null);
    }
    setIsDirty(true);
  }, [selectedStepId]);

  // 移动步骤
  const moveStep = useCallback((stepId: string, direction: 'up' | 'down') => {
    setWorkflow(prev => {
      const steps = [...prev.steps];
      const idx = steps.findIndex(s => s.id === stepId);
      if (idx < 0) return prev;
      
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= steps.length) return prev;
      
      [steps[idx], steps[targetIdx]] = [steps[targetIdx], steps[idx]];
      return { ...prev, steps };
    });
    setIsDirty(true);
  }, []);

  // 复制步骤
  const duplicateStep = useCallback((stepId: string) => {
    setWorkflow(prev => {
      const step = prev.steps.find(s => s.id === stepId);
      if (!step) return prev;
      
      const newStep: ActionStep = {
        ...JSON.parse(JSON.stringify(step)),
        id: `step_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        name: `${step.name} (复制)`,
      };
      
      const idx = prev.steps.findIndex(s => s.id === stepId);
      const steps = [...prev.steps];
      steps.splice(idx + 1, 0, newStep);
      
      return { ...prev, steps };
    });
    setIsDirty(true);
  }, []);

  // 加载工作流
  const loadWorkflow = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/rpa/workflows/${id}`);
      const data = await res.json();
      if (data.workflow) {
        setWorkflow(data.workflow);
        setSelectedStepId(null);
        setIsDirty(false);
      }
    } catch (e) {
      console.error('加载工作流失败', e);
    }
  }, []);

  // 保存工作流
  const saveWorkflow = useCallback(async () => {
    try {
      // 保存到本地文件（通过 API）
      const res = await fetch('/api/rpa/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(workflow),
      });
      if (res.ok) {
        setIsDirty(false);
        alert('工作流已保存');
      }
    } catch (e) {
      console.error('保存失败', e);
      alert('保存失败');
    }
  }, [workflow]);

  return (
    <div className="h-full flex flex-col bg-gray-950 text-white">
      {/* 顶部工具栏 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 flex-shrink-0">
        <div className="flex items-center gap-4">
          {/* 工作流选择 */}
          <select
            value={workflow.id}
            onChange={e => {
              if (e.target.value === '__new__') {
                setWorkflow(createEmptyWorkflow());
                setSelectedStepId(null);
              } else {
                loadWorkflow(e.target.value);
              }
            }}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm"
          >
            <option value="__new__">+ 新建工作流</option>
            {workflows.map(w => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
          
          {/* 工作流名称 */}
          <input
            type="text"
            value={workflow.name}
            onChange={e => updateWorkflow({ name: e.target.value })}
            className="bg-transparent border-b border-transparent hover:border-gray-700 focus:border-pink-500 px-2 py-1 text-sm font-medium outline-none transition-colors"
            placeholder="工作流名称"
          />
          
          {isDirty && (
            <span className="text-xs text-yellow-500">● 未保存</span>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          {/* Tab 切换 */}
          <div className="flex bg-gray-800 rounded-lg p-0.5 mr-4">
            {(['edit', 'run', 'json'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  activeTab === tab
                    ? 'bg-pink-500 text-white'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                {tab === 'edit' ? '📝 编辑' : tab === 'run' ? '▶️ 运行' : '{ } JSON'}
              </button>
            ))}
          </div>
          
          <button
            onClick={saveWorkflow}
            className="px-3 py-1.5 bg-pink-500 hover:bg-pink-600 text-white text-sm rounded-lg transition-colors"
          >
            💾 保存
          </button>
        </div>
      </div>
      
      {/* 主内容区 */}
      <div className="flex-1 flex overflow-hidden">
        {activeTab === 'edit' && (
          <>
            {/* 左侧：节点类型面板 */}
            <div className="w-48 border-r border-gray-800 overflow-y-auto flex-shrink-0">
              <div className="p-3">
                <p className="text-xs text-gray-500 mb-3 font-medium">拖拽或点击添加节点</p>
                {Object.entries(ACTION_CATEGORIES).map(([key, category]) => (
                  <div key={key} className="mb-4">
                    <p className="text-xs text-gray-400 mb-2 flex items-center gap-1">
                      <span>{category.icon}</span>
                      <span>{category.label}</span>
                    </p>
                    <div className="space-y-1">
                      {category.types.map(type => (
                        <button
                          key={type}
                          onClick={() => addStep(type, selectedStepId || undefined)}
                          className="w-full text-left px-2 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 rounded transition-colors truncate"
                        >
                          {ACTION_LABELS[type] || type}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            
            {/* 中间：步骤列表 */}
            <div className="flex-1 overflow-y-auto border-r border-gray-800">
              <StepList
                steps={workflow.steps}
                selectedId={selectedStepId}
                onSelect={setSelectedStepId}
                onDelete={deleteStep}
                onMove={moveStep}
                onDuplicate={duplicateStep}
                actionLabels={ACTION_LABELS}
              />
            </div>
            
            {/* 右侧：属性编辑面板 */}
            <div className="w-80 overflow-y-auto flex-shrink-0">
              {selectedStep ? (
                <StepEditor
                  step={selectedStep}
                  allSteps={workflow.steps}
                  variables={workflow.variables}
                  onUpdate={(updates) => updateStep(selectedStep.id, updates)}
                  actionLabels={ACTION_LABELS}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-gray-500 text-sm">
                  选择一个步骤进行编辑
                </div>
              )}
            </div>
          </>
        )}
        
        {activeTab === 'run' && (
          <WorkflowRunner
            workflow={workflow}
            externalVariables={externalVariables}
          />
        )}
        
        {activeTab === 'json' && (
          <div className="flex-1 p-4 overflow-auto">
            <textarea
              value={JSON.stringify(workflow, null, 2)}
              onChange={e => {
                try {
                  const parsed = JSON.parse(e.target.value);
                  setWorkflow(parsed);
                  setIsDirty(true);
                } catch {
                  // 忽略解析错误
                }
              }}
              className="w-full h-full bg-gray-900 border border-gray-700 rounded-lg p-4 font-mono text-xs text-gray-300 outline-none resize-none"
              spellCheck={false}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// 创建空工作流
function createEmptyWorkflow(): Workflow {
  return {
    id: `workflow_${Date.now()}`,
    name: '新建工作流',
    platform: 'custom',
    version: '1.0.0',
    description: '',
    variables: {},
    steps: [],
  };
}

// 获取默认参数
function getDefaultParams(type: ActionType): Record<string, unknown> {
  switch (type) {
    case 'navigate':
      return { url: '' };
    case 'click':
      return { selector: '' };
    case 'type':
      return { selector: '', text: '' };
    case 'fill':
      return { selector: '', text: '' };
    case 'upload':
      return { selector: '', filePath: '${videoPath}' };
    case 'waitFor':
      return { selector: '', timeout: 30000 };
    case 'waitForHidden':
      return { selector: '', timeout: 30000 };
    case 'sleep':
      return { duration: 1000 };
    case 'captureQR':
      return { selector: '' };
    case 'condition':
      return { condition: {}, onTrue: '', onFalse: '' };
    case 'loop':
      return { times: 3, steps: [] };
    case 'setVariable':
      return { name: '', value: '' };
    case 'emit':
      return { event: '', data: '' };
    default:
      return {};
  }
}

export { ACTION_LABELS, ACTION_CATEGORIES };
