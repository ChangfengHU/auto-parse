'use client';

/**
 * 步骤编辑器组件
 * 
 * 编辑单个步骤的所有属性
 */

import { useState } from 'react';
import { ActionStep, ActionType } from '@/lib/rpa/types';

export interface StepEditorProps {
  step: ActionStep;
  allSteps: ActionStep[];
  variables: Record<string, string>;
  onUpdate: (updates: Partial<ActionStep>) => void;
  actionLabels: Record<string, string>;
}

// 参数配置定义
type ParamConfig = {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'select' | 'checkbox' | 'selector' | 'stepRef';
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  description?: string;
  required?: boolean;
};

// 每种 action 类型的参数配置
const ACTION_PARAMS: Record<string, ParamConfig[]> = {
  navigate: [
    { key: 'url', label: 'URL', type: 'text', placeholder: 'https://...', required: true },
    { key: 'waitUntil', label: '等待条件', type: 'select', options: [
      { value: 'load', label: '页面加载完成' },
      { value: 'domcontentloaded', label: 'DOM加载完成' },
      { value: 'networkidle', label: '网络空闲' },
    ]},
  ],
  click: [
    { key: 'selector', label: '选择器', type: 'selector', required: true },
    { key: 'timeout', label: '超时(ms)', type: 'number', placeholder: '30000' },
    { key: 'force', label: '强制点击', type: 'checkbox', description: '跳过可点击检查' },
  ],
  type: [
    { key: 'selector', label: '选择器', type: 'selector', required: true },
    { key: 'text', label: '文本内容', type: 'textarea', placeholder: '支持 ${变量} 语法', required: true },
    { key: 'delay', label: '输入延迟(ms)', type: 'number', placeholder: '50' },
    { key: 'clear', label: '先清空', type: 'checkbox' },
  ],
  clear: [
    { key: 'selector', label: '选择器', type: 'selector', required: true },
  ],
  press: [
    { key: 'key', label: '按键', type: 'text', placeholder: 'Enter, Tab, Escape...', required: true },
    { key: 'selector', label: '目标元素(可选)', type: 'selector' },
  ],
  hover: [
    { key: 'selector', label: '选择器', type: 'selector', required: true },
  ],
  select: [
    { key: 'selector', label: '选择器', type: 'selector', required: true },
    { key: 'value', label: '选项值', type: 'text', required: true },
  ],
  check: [
    { key: 'selector', label: '选择器', type: 'selector', required: true },
  ],
  uncheck: [
    { key: 'selector', label: '选择器', type: 'selector', required: true },
  ],
  upload: [
    { key: 'selector', label: '上传按钮选择器', type: 'selector', required: true },
    { key: 'filePath', label: '文件路径', type: 'text', placeholder: '${videoPath}', required: true },
  ],
  download: [
    { key: 'url', label: '下载URL', type: 'text', required: true },
    { key: 'savePath', label: '保存路径', type: 'text' },
  ],
  waitForSelector: [
    { key: 'selector', label: '选择器', type: 'selector', required: true },
    { key: 'state', label: '状态', type: 'select', options: [
      { value: 'visible', label: '可见' },
      { value: 'attached', label: '存在' },
      { value: 'hidden', label: '隐藏' },
    ]},
    { key: 'timeout', label: '超时(ms)', type: 'number', placeholder: '30000' },
  ],
  waitForText: [
    { key: 'text', label: '文本内容', type: 'text', required: true },
    { key: 'selector', label: '范围选择器(可选)', type: 'selector' },
    { key: 'timeout', label: '超时(ms)', type: 'number', placeholder: '30000' },
  ],
  waitForHidden: [
    { key: 'selector', label: '选择器', type: 'selector', required: true },
    { key: 'timeout', label: '超时(ms)', type: 'number', placeholder: '30000' },
  ],
  waitForUrl: [
    { key: 'url', label: 'URL匹配', type: 'text', placeholder: '支持正则', required: true },
    { key: 'timeout', label: '超时(ms)', type: 'number', placeholder: '30000' },
  ],
  waitForNavigation: [
    { key: 'timeout', label: '超时(ms)', type: 'number', placeholder: '30000' },
  ],
  sleep: [
    { key: 'duration', label: '等待时间(ms)', type: 'number', placeholder: '1000', required: true },
  ],
  captureQR: [
    { key: 'selector', label: '二维码选择器', type: 'selector', required: true },
    { key: 'emitEvent', label: '发送事件名', type: 'text', placeholder: 'qrcode' },
  ],
  screenshot: [
    { key: 'selector', label: '元素选择器(可选)', type: 'selector' },
    { key: 'savePath', label: '保存路径', type: 'text' },
    { key: 'fullPage', label: '全页面截图', type: 'checkbox' },
  ],
  extractText: [
    { key: 'selector', label: '选择器', type: 'selector', required: true },
    { key: 'variableName', label: '存入变量', type: 'text', required: true },
  ],
  extractAttribute: [
    { key: 'selector', label: '选择器', type: 'selector', required: true },
    { key: 'attribute', label: '属性名', type: 'text', placeholder: 'href, src, data-*', required: true },
    { key: 'variableName', label: '存入变量', type: 'text', required: true },
  ],
  waitForLogin: [
    { key: 'urlPattern', label: 'URL匹配模式', type: 'text', placeholder: 'creator.douyin.com', required: true },
    { key: 'timeout', label: '超时(ms)', type: 'number', placeholder: '120000' },
    { key: 'checkInterval', label: '检查间隔(ms)', type: 'number', placeholder: '2000' },
  ],
  extractCookie: [
    { key: 'domain', label: '域名', type: 'text', placeholder: '.douyin.com' },
    { key: 'names', label: 'Cookie名称(逗号分隔)', type: 'text' },
    { key: 'variableName', label: '存入变量', type: 'text' },
  ],
  injectCookie: [
    { key: 'cookieStr', label: 'Cookie字符串', type: 'textarea', placeholder: '${cookieStr}' },
  ],
  condition: [
    { key: 'conditionType', label: '条件类型', type: 'select', options: [
      { value: 'elementVisible', label: '元素可见' },
      { value: 'elementHidden', label: '元素不可见' },
      { value: 'urlContains', label: 'URL包含' },
      { value: 'urlMatches', label: 'URL匹配' },
      { value: 'variableEquals', label: '变量等于' },
    ]},
    { key: 'conditionValue', label: '条件值', type: 'text', required: true },
    { key: 'onTrue', label: '条件成立跳转', type: 'stepRef' },
    { key: 'onFalse', label: '条件不成立跳转', type: 'stepRef' },
  ],
  loop: [
    { key: 'times', label: '循环次数', type: 'number', placeholder: '3' },
    { key: 'maxDuration', label: '最大时长(ms)', type: 'number', placeholder: '60000' },
  ],
  break: [],
  continue: [],
  goto: [
    { key: 'targetStep', label: '跳转到步骤', type: 'stepRef', required: true },
  ],
  setVariable: [
    { key: 'name', label: '变量名', type: 'text', required: true },
    { key: 'value', label: '变量值', type: 'textarea', placeholder: '支持 ${其他变量}' },
    { key: 'operation', label: '操作', type: 'select', options: [
      { value: 'set', label: '设置' },
      { value: 'increment', label: '自增' },
      { value: 'decrement', label: '自减' },
      { value: 'append', label: '追加' },
    ]},
  ],
  emit: [
    { key: 'event', label: '事件名', type: 'text', placeholder: 'log, qrcode, done...', required: true },
    { key: 'data', label: '数据', type: 'textarea' },
  ],
  log: [
    { key: 'message', label: '日志内容', type: 'textarea', placeholder: '支持 ${变量}', required: true },
    { key: 'level', label: '级别', type: 'select', options: [
      { value: 'info', label: '信息' },
      { value: 'warn', label: '警告' },
      { value: 'error', label: '错误' },
    ]},
  ],
};

export function StepEditor({
  step,
  allSteps,
  variables,
  onUpdate,
  actionLabels,
}: StepEditorProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  
  const params = ACTION_PARAMS[step.type] || [];

  // 更新参数
  const updateParam = (key: string, value: unknown) => {
    onUpdate({
      params: {
        ...step.params,
        [key]: value,
      },
    });
  };

  // 渲染参数输入
  const renderParamInput = (config: ParamConfig) => {
    const value = (step.params as Record<string, unknown>)?.[config.key] ?? '';
    const id = `param-${config.key}`;

    switch (config.type) {
      case 'text':
      case 'selector':
        return (
          <div key={config.key} className="mb-4">
            <label htmlFor={id} className="block text-xs text-gray-400 mb-1">
              {config.label}
              {config.required && <span className="text-red-400 ml-0.5">*</span>}
            </label>
            <input
              id={id}
              type="text"
              value={String(value)}
              onChange={e => updateParam(config.key, e.target.value)}
              placeholder={config.placeholder}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-pink-500 transition-colors"
            />
            {config.description && (
              <p className="text-xs text-gray-500 mt-1">{config.description}</p>
            )}
            {config.type === 'selector' && (
              <p className="text-xs text-gray-600 mt-1">
                支持 CSS 选择器、XPath、:text() 等
              </p>
            )}
          </div>
        );

      case 'textarea':
        return (
          <div key={config.key} className="mb-4">
            <label htmlFor={id} className="block text-xs text-gray-400 mb-1">
              {config.label}
              {config.required && <span className="text-red-400 ml-0.5">*</span>}
            </label>
            <textarea
              id={id}
              value={String(value)}
              onChange={e => updateParam(config.key, e.target.value)}
              placeholder={config.placeholder}
              rows={3}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-pink-500 transition-colors resize-none"
            />
          </div>
        );

      case 'number':
        return (
          <div key={config.key} className="mb-4">
            <label htmlFor={id} className="block text-xs text-gray-400 mb-1">
              {config.label}
            </label>
            <input
              id={id}
              type="number"
              value={value === '' ? '' : Number(value)}
              onChange={e => updateParam(config.key, e.target.value ? Number(e.target.value) : '')}
              placeholder={config.placeholder}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-pink-500 transition-colors"
            />
          </div>
        );

      case 'select':
        return (
          <div key={config.key} className="mb-4">
            <label htmlFor={id} className="block text-xs text-gray-400 mb-1">
              {config.label}
            </label>
            <select
              id={id}
              value={String(value)}
              onChange={e => updateParam(config.key, e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-pink-500 transition-colors"
            >
              <option value="">-- 选择 --</option>
              {config.options?.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        );

      case 'checkbox':
        return (
          <div key={config.key} className="mb-4 flex items-center gap-2">
            <input
              id={id}
              type="checkbox"
              checked={Boolean(value)}
              onChange={e => updateParam(config.key, e.target.checked)}
              className="w-4 h-4 rounded border-gray-700 bg-gray-800 text-pink-500 focus:ring-pink-500"
            />
            <label htmlFor={id} className="text-xs text-gray-400">
              {config.label}
            </label>
            {config.description && (
              <span className="text-xs text-gray-600">({config.description})</span>
            )}
          </div>
        );

      case 'stepRef':
        return (
          <div key={config.key} className="mb-4">
            <label htmlFor={id} className="block text-xs text-gray-400 mb-1">
              {config.label}
            </label>
            <select
              id={id}
              value={String(value)}
              onChange={e => updateParam(config.key, e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-pink-500 transition-colors"
            >
              <option value="">-- 选择步骤 --</option>
              {allSteps.filter(s => s.id !== step.id).map((s, i) => (
                <option key={s.id} value={s.id}>
                  {i + 1}. {s.name}
                </option>
              ))}
            </select>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="p-4">
      {/* 步骤基本信息 */}
      <div className="mb-6 pb-4 border-b border-gray-800">
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs text-pink-400 font-medium">
            {actionLabels[step.type] || step.type}
          </span>
          <span className="text-xs text-gray-600 font-mono">{step.id}</span>
        </div>
        
        <div className="mb-4">
          <label className="block text-xs text-gray-400 mb-1">步骤名称</label>
          <input
            type="text"
            value={step.name}
            onChange={e => onUpdate({ name: e.target.value })}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-pink-500 transition-colors"
          />
        </div>
      </div>

      {/* 参数配置 */}
      <div className="mb-6">
        <h4 className="text-xs text-gray-400 font-medium mb-3">参数配置</h4>
        {params.length === 0 ? (
          <p className="text-xs text-gray-600">此动作无需配置参数</p>
        ) : (
          params.map(renderParamInput)
        )}
      </div>

      {/* 高级选项 */}
      <div className="border-t border-gray-800 pt-4">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          <span>{showAdvanced ? '▼' : '▶'}</span>
          <span>高级选项</span>
        </button>
        
        {showAdvanced && (
          <div className="mt-4 space-y-4">
            {/* 超时配置 */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">超时时间(ms)</label>
              <input
                type="number"
                value={step.timeout ?? ''}
                onChange={e => onUpdate({ timeout: e.target.value ? Number(e.target.value) : undefined })}
                placeholder="30000"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-pink-500"
              />
            </div>

            {/* 流程控制 */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">成功后跳转</label>
              <select
                value={step.onSuccess || ''}
                onChange={e => onUpdate({ onSuccess: e.target.value || undefined })}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-pink-500"
              >
                <option value="">继续下一步</option>
                {allSteps.filter(s => s.id !== step.id).map((s, i) => (
                  <option key={s.id} value={s.id}>{i + 1}. {s.name}</option>
                ))}
                <option value="__end__">结束工作流</option>
              </select>
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">失败后跳转</label>
              <select
                value={step.onFail || ''}
                onChange={e => onUpdate({ onFail: e.target.value || undefined })}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-pink-500"
              >
                <option value="">停止并报错</option>
                {allSteps.filter(s => s.id !== step.id).map((s, i) => (
                  <option key={s.id} value={s.id}>{i + 1}. {s.name}</option>
                ))}
                <option value="__continue__">忽略错误继续</option>
              </select>
            </div>

            {/* 跳过步骤 */}
            <label className="flex items-center gap-2 text-xs text-gray-400">
              <input
                type="checkbox"
                checked={step.skip ?? false}
                onChange={e => onUpdate({ skip: e.target.checked })}
                className="w-4 h-4 rounded border-gray-700 bg-gray-800 text-pink-500"
              />
              跳过此步骤（调试用）
            </label>
          </div>
        )}
      </div>

      {/* 可用变量提示 */}
      {Object.keys(variables).length > 0 && (
        <div className="mt-6 pt-4 border-t border-gray-800">
          <p className="text-xs text-gray-500 mb-2">可用变量：</p>
          <div className="flex flex-wrap gap-1">
            {Object.keys(variables).map(name => (
              <code
                key={name}
                className="px-1.5 py-0.5 bg-gray-800 text-pink-400 text-xs rounded cursor-pointer hover:bg-gray-700"
                onClick={() => navigator.clipboard.writeText(`\${${name}}`)}
                title="点击复制"
              >
                ${'{' + name + '}'}
              </code>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
