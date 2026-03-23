/**
 * 步骤执行器索引
 * 
 * 导出所有执行器并提供注册表
 */

import { Page } from 'playwright';
import { ActionType, ActionParams, ExecutionContext, StepExecutor } from '../types';

// 导出各执行器
export { NavigateExecutor } from './navigate';
export { ClickExecutor } from './click';
export { TypeExecutor } from './type';
export { UploadExecutor } from './upload';
export { WaitForExecutor } from './wait-for';
export { CaptureQRExecutor } from './capture-qr';
export { WaitForLoginExecutor } from './wait-for-login';
export { ExtractCookieExecutor } from './extract-cookie';
export { ConditionExecutor } from './condition';
export { LoopExecutor } from './loop';
export { EmitExecutor } from './emit';
export { SetVariableExecutor } from './set-variable';
export { ScreenshotExecutor } from './screenshot';
export { SleepExecutor } from './sleep';

// 导入执行器实现
import { NavigateExecutor } from './navigate';
import { ClickExecutor } from './click';
import { TypeExecutor } from './type';
import { UploadExecutor } from './upload';
import { WaitForExecutor } from './wait-for';
import { CaptureQRExecutor } from './capture-qr';
import { WaitForLoginExecutor } from './wait-for-login';
import { ExtractCookieExecutor } from './extract-cookie';
import { ConditionExecutor } from './condition';
import { LoopExecutor } from './loop';
import { EmitExecutor } from './emit';
import { SetVariableExecutor } from './set-variable';
import { ScreenshotExecutor } from './screenshot';
import { SleepExecutor } from './sleep';

/**
 * 执行器注册表
 */
const executorInstances: Partial<Record<ActionType, StepExecutor>> = {};

function getOrCreateExecutor<T extends StepExecutor>(
  type: ActionType,
  factory: () => T,
): T {
  if (!executorInstances[type]) {
    executorInstances[type] = factory();
  }
  return executorInstances[type] as T;
}

/**
 * 获取指定动作类型的执行器
 */
export function getExecutor(type: ActionType): StepExecutor | null {
  switch (type) {
    // 页面导航
    case 'navigate':
    case 'reload':
    case 'goBack':
    case 'goForward':
      return getOrCreateExecutor('navigate', () => new NavigateExecutor());

    // 元素交互 - 点击类
    case 'click':
    case 'dblclick':
    case 'rightClick':
      return getOrCreateExecutor('click', () => new ClickExecutor());

    // 元素交互 - 输入类
    case 'type':
    case 'fill':
    case 'clear':
    case 'press':
      return getOrCreateExecutor('type', () => new TypeExecutor());

    // 上传
    case 'upload':
      return getOrCreateExecutor('upload', () => new UploadExecutor());

    // 等待
    case 'waitFor':
    case 'waitForHidden':
    case 'waitForEnabled':
    case 'waitForUrl':
    case 'waitForNetwork':
      return getOrCreateExecutor('waitFor', () => new WaitForExecutor());

    // 睡眠
    case 'sleep':
      return getOrCreateExecutor('sleep', () => new SleepExecutor());

    // 登录相关
    case 'captureQR':
      return getOrCreateExecutor('captureQR', () => new CaptureQRExecutor());

    case 'waitForLogin':
      return getOrCreateExecutor('waitForLogin', () => new WaitForLoginExecutor());

    case 'extractCookie':
      return getOrCreateExecutor('extractCookie', () => new ExtractCookieExecutor());

    // 截图
    case 'screenshot':
    case 'screenshotElement':
      return getOrCreateExecutor('screenshot', () => new ScreenshotExecutor());

    // 流程控制
    case 'condition':
      return getOrCreateExecutor('condition', () => new ConditionExecutor());

    case 'loop':
    case 'while':
      return getOrCreateExecutor('loop', () => new LoopExecutor());

    // 事件
    case 'emit':
    case 'log':
      return getOrCreateExecutor('emit', () => new EmitExecutor());

    // 变量
    case 'setVariable':
    case 'deleteVariable':
    case 'incrementVariable':
    case 'appendVariable':
      return getOrCreateExecutor('setVariable', () => new SetVariableExecutor());

    // 未实现的执行器返回 null
    default:
      console.warn(`[RPA] 未实现的执行器: ${type}`);
      return null;
  }
}

/**
 * 执行单个步骤
 */
export async function executeAction(
  type: ActionType,
  page: Page,
  params: ActionParams,
  context: ExecutionContext,
): Promise<void> {
  const executor = getExecutor(type);
  
  if (!executor) {
    throw new Error(`不支持的动作类型: ${type}`);
  }

  await executor.execute(page, params, context);
}
