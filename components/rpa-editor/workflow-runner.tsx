'use client';

/**
 * 工作流运行器组件
 * 
 * 执行工作流并显示实时日志
 */

import { useState, useRef, useCallback } from 'react';
import { Workflow } from '@/lib/rpa/types';

export interface WorkflowRunnerProps {
  workflow: Workflow;
  externalVariables?: Record<string, string>;
}

interface LogEntry {
  time: string;
  type: 'info' | 'success' | 'error' | 'warn' | 'qrcode';
  message: string;
  stepId?: string;
}

export function WorkflowRunner({
  workflow,
  externalVariables = {},
}: WorkflowRunnerProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [variables, setVariables] = useState<Record<string, string>>({
    ...workflow.variables,
    ...externalVariables,
  });
  
  const logsEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const addLog = useCallback((type: LogEntry['type'], message: string, stepId?: string) => {
    const time = new Date().toLocaleTimeString('zh-CN');
    setLogs(prev => [...prev, { time, type, message, stepId }]);
    setTimeout(() => logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  }, []);

  const handleRun = async () => {
    if (isRunning) return;
    
    setIsRunning(true);
    setLogs([]);
    setQrCode(null);
    setCurrentStep(null);
    
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      addLog('info', `🚀 开始执行工作流: ${workflow.name}`);
      
      const res = await fetch('/api/rpa/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflow,
          variables,
        }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const err = await res.json();
        addLog('error', err.error || '请求失败');
        setIsRunning(false);
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const { type, payload } = JSON.parse(line.slice(6));
            
            if (type === 'log') {
              // 解析步骤信息
              const stepMatch = payload.match(/\[步骤:([^\]]+)\]/);
              const stepId = stepMatch?.[1];
              if (stepId) setCurrentStep(stepId);
              
              if (payload.includes('✅')) {
                addLog('success', payload, stepId);
              } else if (payload.includes('❌')) {
                addLog('error', payload, stepId);
              } else if (payload.includes('⚠️')) {
                addLog('warn', payload, stepId);
              } else {
                addLog('info', payload, stepId);
              }
            } else if (type === 'qrcode') {
              setQrCode(payload);
              addLog('qrcode', '📱 请扫描二维码登录');
            } else if (type === 'done') {
              try {
                const result = JSON.parse(payload);
                addLog('success', `✅ 工作流执行完成 (${result.duration / 1000}s)`);
              } catch {
                addLog('success', payload);
              }
              setQrCode(null);
            } else if (type === 'error') {
              addLog('error', payload);
            } else if (type === 'stepStart') {
              setCurrentStep(payload);
            } else if (type === 'stepEnd') {
              setCurrentStep(null);
            }
          } catch {
            // ignore
          }
        }
      }
    } catch (e) {
      if ((e as { name?: string }).name !== 'AbortError') {
        addLog('error', `执行异常: ${e}`);
      }
    } finally {
      setIsRunning(false);
      abortRef.current = null;
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setIsRunning(false);
    addLog('warn', '⏹️ 用户停止执行');
  };

  const handleClear = () => {
    setLogs([]);
    setQrCode(null);
    setCurrentStep(null);
  };

  // 更新变量
  const updateVariable = (key: string, value: string) => {
    setVariables(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* 变量输入区 */}
      <div className="p-4 border-b border-gray-800 flex-shrink-0">
        <h3 className="text-sm font-medium text-gray-300 mb-3">运行参数</h3>
        <div className="grid grid-cols-2 gap-3">
          {/* 视频URL - 常用 */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">视频地址</label>
            <input
              type="text"
              value={variables.videoUrl || ''}
              onChange={e => updateVariable('videoUrl', e.target.value)}
              placeholder="OSS URL 或公开视频链接"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-pink-500"
              disabled={isRunning}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">标题</label>
            <input
              type="text"
              value={variables.title || ''}
              onChange={e => updateVariable('title', e.target.value)}
              placeholder="视频标题"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-pink-500"
              disabled={isRunning}
            />
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-gray-500 mb-1">描述</label>
            <textarea
              value={variables.description || ''}
              onChange={e => updateVariable('description', e.target.value)}
              placeholder="视频描述（可选）"
              rows={2}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-pink-500 resize-none"
              disabled={isRunning}
            />
          </div>
        </div>
        
        {/* 工作流自定义变量 */}
        {Object.keys(workflow.variables).filter(k => !['videoUrl', 'title', 'description'].includes(k)).length > 0 && (
          <details className="mt-3">
            <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-400">
              更多变量 ({Object.keys(workflow.variables).length})
            </summary>
            <div className="grid grid-cols-2 gap-2 mt-2">
              {Object.entries(workflow.variables)
                .filter(([k]) => !['videoUrl', 'title', 'description'].includes(k))
                .map(([key, defaultValue]) => (
                  <div key={key}>
                    <label className="block text-xs text-gray-600 mb-1">{key}</label>
                    <input
                      type="text"
                      value={variables[key] ?? defaultValue}
                      onChange={e => updateVariable(key, e.target.value)}
                      className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white outline-none focus:border-pink-500"
                      disabled={isRunning}
                    />
                  </div>
                ))}
            </div>
          </details>
        )}
      </div>

      {/* 控制按钮 */}
      <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-3 flex-shrink-0">
        {!isRunning ? (
          <button
            onClick={handleRun}
            disabled={workflow.steps.length === 0}
            className="px-4 py-2 bg-pink-500 hover:bg-pink-600 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            ▶️ 运行工作流
          </button>
        ) : (
          <button
            onClick={handleStop}
            className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded-lg transition-colors"
          >
            ⏹️ 停止
          </button>
        )}
        
        <button
          onClick={handleClear}
          className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg transition-colors"
        >
          🗑️ 清空日志
        </button>
        
        {currentStep && (
          <span className="text-xs text-gray-500">
            当前步骤: <span className="text-pink-400">{currentStep}</span>
          </span>
        )}
      </div>

      {/* 二维码区域 */}
      {qrCode && (
        <div className="px-4 py-4 border-b border-yellow-500/30 bg-yellow-500/5 flex items-center gap-4 flex-shrink-0">
          <img
            src={qrCode}
            alt="扫码登录"
            className="w-32 h-32 rounded-lg bg-white p-2"
          />
          <div>
            <p className="text-yellow-400 font-medium">📱 请使用抖音 App 扫码登录</p>
            <p className="text-gray-400 text-sm mt-1">扫码后在 App 内确认授权</p>
            <p className="text-gray-500 text-xs mt-2">二维码有效期约 3 分钟</p>
          </div>
        </div>
      )}

      {/* 日志区域 */}
      <div className="flex-1 overflow-y-auto p-4 font-mono text-sm">
        {logs.length === 0 ? (
          <div className="text-gray-600 text-center py-8">
            点击"运行工作流"开始执行
          </div>
        ) : (
          logs.map((log, i) => (
            <div
              key={i}
              className={`py-1 ${
                log.type === 'error' ? 'text-red-400' :
                log.type === 'success' ? 'text-green-400' :
                log.type === 'warn' ? 'text-yellow-400' :
                log.type === 'qrcode' ? 'text-yellow-400' :
                'text-gray-400'
              }`}
            >
              <span className="text-gray-600 mr-2">[{log.time}]</span>
              {log.message}
            </div>
          ))
        )}
        <div ref={logsEndRef} />
      </div>

      {/* 步骤进度指示器 */}
      {isRunning && workflow.steps.length > 0 && (
        <div className="px-4 py-3 border-t border-gray-800 flex-shrink-0">
          <div className="flex items-center gap-1 overflow-x-auto">
            {workflow.steps.map((step, i) => {
              const isCurrent = step.id === currentStep;
              const isPassed = logs.some(l => l.stepId === step.id && l.type === 'success');
              const isFailed = logs.some(l => l.stepId === step.id && l.type === 'error');
              
              return (
                <div
                  key={step.id}
                  className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs transition-all ${
                    isCurrent ? 'bg-pink-500 text-white animate-pulse' :
                    isPassed ? 'bg-green-600 text-white' :
                    isFailed ? 'bg-red-600 text-white' :
                    'bg-gray-800 text-gray-500'
                  }`}
                  title={step.name}
                >
                  {i + 1}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
