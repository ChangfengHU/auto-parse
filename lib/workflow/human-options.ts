export interface HumanOptions {
  humanMouse: boolean      // 贝塞尔曲线鼠标移动（click 前先移动到元素）
  humanType: boolean       // 逐键触发输入（pressSequentially + 随机节奏）
  randomDelay: boolean     // 步骤间随机停顿 1~4s
  idleSimulation: boolean  // 空闲时随机鼠标移动 / 滚动
}

export const DEFAULT_HUMAN_OPTIONS: HumanOptions = {
  humanMouse: false,
  humanType: false,
  randomDelay: false,
  idleSimulation: false,
};
