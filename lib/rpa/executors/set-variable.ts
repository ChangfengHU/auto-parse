/**
 * 变量操作执行器
 * 
 * 支持: setVariable, deleteVariable, incrementVariable, appendVariable
 */

import { Page } from 'playwright';
import { ActionParams, ExecutionContext, StepExecutor } from '../types';

export class SetVariableExecutor implements StepExecutor {
  async execute(
    page: Page,
    params: ActionParams,
    context: ExecutionContext,
  ): Promise<void> {
    const variableName = params.variableName;
    
    if (!variableName) {
      throw new Error('变量操作缺少 variableName 参数');
    }

    const value = params.variableValue !== undefined 
      ? context.resolve(params.variableValue)
      : params.value !== undefined 
        ? context.resolve(params.value) 
        : '';

    context.variables.set(variableName, value);
    context.log(`设置变量: $\{${variableName}} = "${value.slice(0, 50)}${value.length > 50 ? '...' : ''}"`);
  }

  /**
   * 删除变量
   */
  async deleteVariable(
    page: Page,
    params: ActionParams,
    context: ExecutionContext,
  ): Promise<void> {
    const variableName = params.variableName;
    
    if (!variableName) {
      throw new Error('删除变量操作缺少 variableName 参数');
    }

    context.variables.delete(variableName);
    context.log(`删除变量: $\{${variableName}}`);
  }

  /**
   * 变量自增
   */
  async incrementVariable(
    page: Page,
    params: ActionParams,
    context: ExecutionContext,
  ): Promise<void> {
    const variableName = params.variableName;
    
    if (!variableName) {
      throw new Error('变量自增操作缺少 variableName 参数');
    }

    const currentValue = context.variables.get(variableName) ?? '0';
    const increment = params.value ? parseInt(params.value, 10) : 1;
    const newValue = parseInt(currentValue, 10) + increment;

    context.variables.set(variableName, String(newValue));
    context.log(`变量自增: $\{${variableName}} = ${newValue}`);
  }

  /**
   * 追加到变量
   */
  async appendVariable(
    page: Page,
    params: ActionParams,
    context: ExecutionContext,
  ): Promise<void> {
    const variableName = params.variableName;
    
    if (!variableName) {
      throw new Error('追加变量操作缺少 variableName 参数');
    }

    const currentValue = context.variables.get(variableName) ?? '';
    const appendValue = params.value ? context.resolve(params.value) : '';
    const separator = params.delimiter ?? '';
    const newValue = currentValue + separator + appendValue;

    context.variables.set(variableName, newValue);
    context.log(`追加变量: $\{${variableName}} += "${appendValue}"`);
  }
}
