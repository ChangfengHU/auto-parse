/**
 * 将节点/任务层统一错误串拆成 API 用的 error_code + error_msg。
 * 约定：extract_image_download 的 FailFast 为 FAIL_FAST: NODE=…; <reason>
 */

export interface ParsedWorkflowError {
  error_code: string;
  error_msg: string;
}

export function parseWorkflowStepErrorMessage(message: string): ParsedWorkflowError {
  const trimmed = message.trim();
  const nodeMatch = trimmed.match(/^FAIL_FAST:\s*NODE=([^;]+);\s*(.+)$/s);
  if (nodeMatch) {
    return { error_code: 'FAIL_FAST', error_msg: nodeMatch[2].trim() };
  }
  if (trimmed.startsWith('FAIL_FAST:')) {
    return {
      error_code: 'FAIL_FAST',
      error_msg: trimmed.replace(/^FAIL_FAST:\s*/i, '').trim(),
    };
  }
  return { error_code: 'ERROR', error_msg: trimmed };
}
