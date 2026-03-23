/**
 * RPA 模块入口
 */

// 类型导出
export * from './types';

// 核心类导出
export { RPAEngine, runWorkflow, runWorkflowFromJson } from './engine';
export { VariableResolver } from './variable-resolver';
export { SelectorResolver } from './selector-resolver';
export { ConditionEvaluator } from './condition-evaluator';

// 执行器导出
export { getExecutor, executeAction } from './executors';
