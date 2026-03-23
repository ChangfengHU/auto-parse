/**
 * RPA 执行引擎
 * 
 * 核心职责：
 * 1. 解析工作流配置
 * 2. 按步骤顺序执行
 * 3. 处理流程跳转（onSuccess/onFail）
 * 4. 变量替换和条件判断
 * 5. 错误处理和重试
 */

import { Page } from 'playwright';
import {
  Workflow,
  ActionStep,
  ActionType,
  ActionParams,
  ExecutionResult,
  StepResult,
  StepLog,
  ExecutionContext,
  EmitFn,
  RPAEngineConfig,
  ConditionExpr,
} from './types';
import { VariableResolver } from './variable-resolver';
import { SelectorResolver } from './selector-resolver';
import { ConditionEvaluator } from './condition-evaluator';
import { getExecutor } from './executors';
import { ConditionExecutor } from './executors/condition';

export class RPAEngine {
  private page: Page;
  private workflow: Workflow;
  private variableResolver: VariableResolver;
  private selectorResolver: SelectorResolver;
  private conditionEvaluator: ConditionEvaluator;
  private emit: EmitFn;
  private config: RPAEngineConfig;
  
  private stepLogs: StepLog[] = [];
  private startTime: number = 0;
  private aborted: boolean = false;
  private executionId: string;
  
  // 循环状态
  private loopState = {
    shouldBreak: false,
    shouldContinue: false,
  };

  constructor(
    page: Page,
    workflow: Workflow,
    emit: EmitFn = () => {},
    config: RPAEngineConfig = {},
  ) {
    this.page = page;
    this.workflow = workflow;
    this.emit = emit;
    this.config = {
      defaultTimeout: 30000,
      defaultRetryTimes: 0,
      defaultRetryDelay: 1000,
      screenshotOnStep: false,
      screenshotOnError: true,
      debug: false,
      ...config,
    };

    // 初始化变量解析器
    this.variableResolver = new VariableResolver(workflow.variables);
    this.selectorResolver = new SelectorResolver(page, this.config.defaultTimeout);
    this.conditionEvaluator = new ConditionEvaluator(page, this.variableResolver);
    
    // 生成执行 ID
    this.executionId = `exec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 公开方法
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * 设置单个变量
   */
  setVariable(key: string, value: string): void {
    this.variableResolver.set(key, value);
  }

  /**
   * 批量设置变量
   */
  setVariables(vars: Record<string, string>): void {
    this.variableResolver.setAll(vars);
  }

  /**
   * 获取变量值
   */
  getVariable(key: string): string | undefined {
    return this.variableResolver.get(key);
  }

  /**
   * 获取所有变量
   */
  getVariables(): Record<string, string> {
    return this.variableResolver.getAll();
  }

  /**
   * 中止执行
   */
  abort(): void {
    this.aborted = true;
    this.log('⚠️ 收到中止信号');
  }

  /**
   * 运行工作流
   */
  async run(): Promise<ExecutionResult> {
    this.startTime = Date.now();
    this.stepLogs = [];
    this.aborted = false;

    this.log(`🚀 开始执行工作流: ${this.workflow.name} (${this.workflow.id})`);
    this.emit('log', `🚀 开始执行: ${this.workflow.name}`);

    const stepsMap = new Map(this.workflow.steps.map(s => [s.id, s]));
    let currentStepId: string | undefined = this.workflow.steps[0]?.id;
    let stepsExecuted = 0;

    try {
      while (currentStepId && !this.aborted) {
        const step = stepsMap.get(currentStepId);
        if (!step) {
          this.log(`⚠️ 未找到步骤: ${currentStepId}`);
          break;
        }

        // 检查是否跳过
        if (step.skip) {
          this.log(`⏭️ 跳过步骤: ${step.id}`);
          currentStepId = step.onSuccess ?? this.getNextStepId(step.id);
          continue;
        }

        // 检查条件执行
        if (step.when) {
          const shouldExecute = await this.conditionEvaluator.evaluate(step.when);
          if (!shouldExecute) {
            this.log(`⏭️ 条件不满足，跳过: ${step.id}`);
            this.addStepLog(step, 'skip', 0);
            currentStepId = step.onSuccess ?? this.getNextStepId(step.id);
            continue;
          }
        }

        // 执行步骤
        const stepStartTime = Date.now();
        const result = await this.executeStep(step);
        const stepDuration = Date.now() - stepStartTime;

        stepsExecuted++;
        this.addStepLog(step, result.status, stepDuration, result.error, result.screenshotUrl);

        // 回调
        if (this.config.onAfterStep) {
          await this.config.onAfterStep(step, result);
        }

        // 确定下一步
        if (result.status === 'success') {
          currentStepId = result.nextStepId ?? step.onSuccess ?? this.getNextStepId(step.id);
        } else if (result.status === 'fail') {
          if (step.onFail) {
            currentStepId = step.onFail;
          } else {
            // 没有 onFail 处理，终止工作流
            throw new Error(result.error ?? `步骤 ${step.id} 执行失败`);
          }
        } else {
          // skip
          currentStepId = step.onSuccess ?? this.getNextStepId(step.id);
        }
      }

      const duration = Date.now() - this.startTime;
      this.log(`✅ 工作流执行完成 (${stepsExecuted} 步, ${duration}ms)`);
      this.emit('log', `✅ 执行完成 (${Math.round(duration / 1000)}s)`);

      return {
        success: true,
        stepsExecuted,
        duration,
        variables: this.variableResolver.getAll(),
        executionId: this.executionId,
        stepLogs: this.stepLogs,
      };

    } catch (error) {
      const duration = Date.now() - this.startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.log(`❌ 工作流执行失败: ${errorMessage}`);
      this.emit('error', errorMessage);

      return {
        success: false,
        stepsExecuted,
        duration,
        error: errorMessage,
        variables: this.variableResolver.getAll(),
        executionId: this.executionId,
        stepLogs: this.stepLogs,
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 内部方法
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * 执行单个步骤
   */
  private async executeStep(step: ActionStep): Promise<StepResult> {
    const stepName = step.name ?? step.id;
    this.log(`▶ 执行步骤: ${stepName} (${step.type})`);

    // 回调
    if (this.config.onBeforeStep) {
      await this.config.onBeforeStep(step);
    }

    // 创建执行上下文
    const context = this.createContext();

    // 解析参数
    const params = this.variableResolver.resolveObject(step.params as Record<string, unknown>) as typeof step.params;
    const timeout = step.timeout ?? this.config.defaultTimeout ?? 30000;

    // 获取执行器
    const executor = getExecutor(step.type);
    
    // 特殊处理 condition 类型
    if (step.type === 'condition') {
      return await this.executeCondition(step, params, context);
    }

    if (!executor) {
      return {
        status: 'fail',
        error: `不支持的动作类型: ${step.type}`,
      };
    }

    // 重试配置
    const retryTimes = step.retry?.times ?? this.config.defaultRetryTimes ?? 0;
    const retryDelay = step.retry?.delayMs ?? this.config.defaultRetryDelay ?? 1000;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retryTimes; attempt++) {
      try {
        // 设置超时
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`步骤超时 (${timeout}ms)`)), timeout);
        });

        // 执行步骤
        await Promise.race([
          executor.execute(this.page, params, context),
          timeoutPromise,
        ]);

        // 步骤后截图
        if (this.config.screenshotOnStep) {
          await context.screenshot(`step_${step.id}`);
        }

        return { status: 'success' };

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < retryTimes) {
          this.log(`⚠️ 步骤失败，${retryDelay}ms 后重试 (${attempt + 1}/${retryTimes}): ${lastError.message}`);
          await this.page.waitForTimeout(retryDelay);
        }
      }
    }

    // 失败时截图
    let screenshotUrl: string | undefined;
    if (this.config.screenshotOnError) {
      screenshotUrl = await context.screenshot(`error_${step.id}`) ?? undefined;
    }

    return {
      status: 'fail',
      error: lastError?.message ?? '未知错误',
      screenshotUrl,
    };
  }

  /**
   * 执行条件分支
   */
  private async executeCondition(
    step: ActionStep,
    params: ActionParams,
    context: ExecutionContext,
  ): Promise<StepResult> {
    const conditionExecutor = new ConditionExecutor();
    const result = await conditionExecutor.evaluate(this.page, params, context);

    this.log(`条件判断结果: ${result ? '✅ 满足' : '❌ 不满足'}`);

    return {
      status: 'success',
      nextStepId: result ? step.onSuccess : step.onFail,
    };
  }

  /**
   * 创建执行上下文
   */
  private createContext(): ExecutionContext {
    return {
      variables: new Map(Object.entries(this.variableResolver.getAll())),
      resolve: (template: string) => this.variableResolver.resolve(template),
      emit: this.emit,
      log: (msg: string) => this.log(msg),
      screenshot: async (name: string) => {
        try {
          const buffer = await this.page.screenshot({ fullPage: false, timeout: 5000 });
          // 这里可以上传到 OSS 并返回 URL
          // 暂时返回 base64
          return `data:image/png;base64,${buffer.toString('base64')}`;
        } catch {
          return null;
        }
      },
      loopState: this.loopState,
    };
  }

  /**
   * 获取下一个步骤 ID（顺序执行）
   */
  private getNextStepId(currentId: string): string | undefined {
    const index = this.workflow.steps.findIndex(s => s.id === currentId);
    if (index >= 0 && index < this.workflow.steps.length - 1) {
      return this.workflow.steps[index + 1].id;
    }
    return undefined;
  }

  /**
   * 记录日志
   */
  private log(message: string): void {
    if (this.config.debug) {
      console.log(`[RPA] ${message}`);
    }
  }

  /**
   * 添加步骤日志
   */
  private addStepLog(
    step: ActionStep,
    status: StepLog['status'],
    duration: number,
    error?: string,
    screenshotUrl?: string,
  ): void {
    this.stepLogs.push({
      stepId: step.id,
      stepName: step.name,
      status,
      error,
      screenshotUrl,
      duration,
      timestamp: new Date().toISOString(),
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 便捷函数
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 执行工作流（便捷函数）
 */
export async function runWorkflow(
  page: Page,
  workflow: Workflow,
  variables: Record<string, string> = {},
  emit: EmitFn = () => {},
  config: RPAEngineConfig = {},
): Promise<ExecutionResult> {
  const engine = new RPAEngine(page, workflow, emit, config);
  engine.setVariables(variables);
  return await engine.run();
}

/**
 * 从 JSON 加载并执行工作流
 */
export async function runWorkflowFromJson(
  page: Page,
  workflowJson: string | object,
  variables: Record<string, string> = {},
  emit: EmitFn = () => {},
  config: RPAEngineConfig = {},
): Promise<ExecutionResult> {
  const workflow: Workflow = typeof workflowJson === 'string' 
    ? JSON.parse(workflowJson) 
    : workflowJson;
  
  return await runWorkflow(page, workflow, variables, emit, config);
}
