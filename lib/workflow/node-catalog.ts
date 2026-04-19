/**
 * 节点目录 — 所有可用节点的元数据、默认参数、参数说明
 */
import type { NodeType } from './types';
import { DEFAULT_TEXT_INPUT_POLL_UNTIL_SELECTOR } from './types';

export interface ParamMeta {
  label: string       // 显示名称
  desc: string        // 悬浮说明
  type: 'string' | 'number' | 'boolean' | 'selector' | 'url' | 'template' | 'array' | 'select' | 'hotkey' | 'elements'
  required?: boolean
  example?: string
  options?: Array<{ label: string; value: string }>
}

export interface NodeCatalogItem {
  type: NodeType
  label: string
  icon: string
  category: 'basic' | 'advanced'
  desc: string                          // 节点一句话说明
  defaultParams: Record<string, unknown>
  paramMeta: Record<string, ParamMeta>  // 每个参数的说明
}

// ── 通用参数说明（跨节点复用）────────────────────────────────────────────────

const SELECTOR_META: ParamMeta = {
  label: '元素选择器',
  desc: '支持 CSS 选择器（如 .class、#id、input[type=file]）或 XPath（以 // 开头，如 //button[@text="发布"]）',
  type: 'selector',
  required: true,
  example: 'input[type="file"] 或 //button[contains(text(),"发布")]',
};

const URL_META: ParamMeta = {
  label: '目标 URL',
  desc: '要导航到的完整 URL，支持 {{变量名}} 模板。设置后节点执行前自动跳转到此页面',
  type: 'url',
  example: 'https://creator.douyin.com',
};

const TIMEOUT_META: ParamMeta = {
  label: '超时时间（ms）',
  desc: '最长等待时间（毫秒）。超时后根据 timeoutAction 决定是继续还是报错',
  type: 'number',
  example: '30000',
};

// ── 节点目录 ──────────────────────────────────────────────────────────────────

export const NODE_CATALOG: NodeCatalogItem[] = [
  // ── 基础节点 ──────────────────────────────────────────────────────────────

  {
    type: 'material',
    label: '素材节点',
    icon: '📦',
    category: 'basic',
    desc: '从素材库选择一条素材，输出视频地址和标题两个变量供后续节点使用',
    defaultParams: {
      materialId: '',
      outputVideoVar: 'videoUrl',
      outputTitleVar: 'title',
    },
    paramMeta: {
      materialId: {
        label: '素材 ID',
        desc: '从素材库中选中的素材唯一 ID。通常通过右侧素材选择器设置，无需手填',
        type: 'string',
        required: true,
        example: '1710000000000-abcd',
      },
      outputVideoVar: {
        label: '视频变量名',
        desc: '执行后把素材的 OSS 视频地址写入这个变量名，供上传节点使用',
        type: 'string',
        required: true,
        example: 'videoUrl',
      },
      outputTitleVar: {
        label: '标题变量名',
        desc: '执行后把素材标题写入这个变量名，供标题输入节点使用',
        type: 'string',
        required: true,
        example: 'title',
      },
    },
  },

  {
    type: 'navigate',
    label: '导航',
    icon: '🌐',
    category: 'basic',
    desc: '跳转到指定 URL，等待页面加载完成；支持通过 AdsPower 分身进行高匿访问',
    defaultParams: {
      url: 'https://',
      waitUntil: 'domcontentloaded',
      useAdsPower: false,
      adsProfileId: 'k1aomp3q',
      adsApiKey: '74f06f7e8e8e83ccafd060d7942cb9530087279d8cf923d4',
      adsApiUrl: 'http://local.adspower.net:50325',
      adsManualCdpUrl: '',
      adsProxyServer: '',
      adsDisableAutoStart: false,
      postClickEnabled: false,
      postClickElements: [],
    },
    paramMeta: {
      url: { ...URL_META, required: true },
      waitUntil: {
        label: '等待策略',
        desc: 'load=等待所有资源加载完成；domcontentloaded=DOM 解析完成即可（较快）；networkidle=网络空闲（最慢但最稳）',
        type: 'string',
        example: 'domcontentloaded',
      },
      useAdsPower: {
        label: '🛡 启用 AdsPower 隔离容器',
        desc: '开启后，该节点及后续所有交互都将在指定的 AdsPower 高匿浏览器分身中运行。',
        type: 'boolean',
      },
      adsProfileId: {
        label: '分身编号 (Profile ID)',
        desc: 'AdsPower 分身环境编号，如 k1aomp3q。开启上方开关后生效。',
        type: 'string',
        example: 'k1aomp3q',
      },
      adsApiKey: {
        label: 'API 密钥 (API Key)',
        desc: '选填。AdsPower 客户端设置页面中的 Local API Key。',
        type: 'string',
      },
      adsApiUrl: {
        label: 'API 地址',
        desc: 'AdsPower 本地服务地址，默认 http://local.adspower.net:50325。',
        type: 'string',
      },
      adsManualCdpUrl: { 
        label: '手动 CDP 地址 (直连方案/终极退路)', 
        desc: '💡 终极方案：如果 API 直连一直报 Require api-key，请手动填入已打开浏览器的 CDP 调试链接（形如 ws://127.0.0.1:xxxx/devtools/browser/...）。',
        type: 'string'
      },
      adsProxyServer: {
        label: '强制代理地址 (可选)',
        desc: '用于 AdsPower 启动时透传 --proxy-server，示例：http://direct.miyaip.online:8001。留空则仅使用分身自身代理配置。',
        type: 'string',
        example: 'http://direct.miyaip.online:8001',
      },
      adsDisableAutoStart: {
        label: '禁用自动拉起分身',
        desc: '开启后仅复用 active 分身（配额保护）；关闭时允许在 inactive 时调用 browser/start 提升成功率。',
        type: 'boolean',
      },
      postClickEnabled: {
        label: '🖱️ 启用后置点击',
        desc: '导航完成后立即执行一个点击操作（如点击"Create image"按钮）。可减少后续节点数量。',
        type: 'boolean',
      },
      postClickElements: {
        label: '后置点击候选元素',
        desc: '💡 支持多个候选（按优先级尝试）。每个元素可用文字（text）或选择器（selector）定位。点击成功第一个候选后停止。',
        type: 'elements',
      },
      timeout: TIMEOUT_META,
    },
  },


  {
    type: 'click',
    label: '点击',
    icon: '👆',
    category: 'basic',
    desc: '点击页面上的按钮或链接。优先用 text（文字定位），其次用 selector',
    defaultParams: { text: '', selector: '', useSelector: false, elements: [] },
    paramMeta: {
      useSelector: {
        label: '使用选择器模式',
        desc: '关闭时按按钮文字点击；开启后按 selector 选择器点击元素',
        type: 'boolean',
      },
      text: {
        label: '按钮文字',
        desc: '按钮/链接的文字内容，用于精准定位元素（推荐）。与 selector 二选一，text 优先',
        type: 'string',
        example: '发布',
      },
      selector: {
        ...SELECTOR_META,
        required: false,
        desc: '元素的 CSS 选择器或 XPath。开启“选择器模式”后，点击时使用这个字段定位元素',
      },
      elements: {
        label: '多候选元素',
        desc: '💡 推荐：支持填写多个候选目标（文字或选择器）。执行时从上至下尝试，点击成功第一个即可。适用于中英文文案差异或 UI 变动。',
        type: 'elements',
      },
      nth: {
        label: '第几个匹配',
        desc: '当有多个匹配元素时，指定点击第几个（0=第一个，-1=最后一个）。默认点最后一个',
        type: 'number',
        example: '0',
      },
      timeout: TIMEOUT_META,
    },
  },

  {
    type: 'text_input',
    label: '文本输入',
    icon: '✏️',
    category: 'basic',
    desc: '在输入框中填写文本，支持 {{变量名}} 模板动态插值',
    defaultParams: {
      selector: '',
      value: '',
      inputMode: 'fill',
      autoEnter: false,
      autoEnterPollUntilStop: false,
      autoEnterPollUntilSelector: DEFAULT_TEXT_INPUT_POLL_UNTIL_SELECTOR,
      autoEnterPollIntervalMs: 3000,
      autoEnterPollMaxMs: 180000,
    },
    paramMeta: {
      selector: SELECTOR_META,
      value: {
        label: '输入内容',
        desc: '要填入的文本。支持 {{变量名}} 模板，变量从"发布参数"中自动获取。例如：{{title}} 会替换为实际标题',
        type: 'template',
        required: true,
        example: '{{title}} 或 固定文本',
      },
      inputMode: {
        label: '输入方式',
        desc: 'fill=整段直接填入（默认）；type=模拟键盘输入（对某些富文本/监听键盘事件的输入框更稳）',
        type: 'select',
        options: [
          { label: 'fill（整段填入）', value: 'fill' },
          { label: 'type（模拟键盘）', value: 'type' },
        ],
      },
      clear: {
        label: '先清空',
        desc: '填入前是否先清空输入框内容（默认 true）',
        type: 'boolean',
      },
      delay: {
        label: '输入延迟（ms/字符）',
        desc: '每个字符之间的延迟毫秒数（type 模式下生效）。0=瞬间输入（默认）',
        type: 'number',
        example: '50',
      },
      autoEnter: {
        label: '⌨️ 自动回车',
        desc: '输入完成后是否自动按下回车键（模拟 Enter 键）',
        type: 'boolean',
      },
      autoEnterPollUntilStop: {
        label: '定时回车直到结束',
        desc:
          '开启后：按「轮询间隔」重复在输入框按 Enter，直到满足下方「结束条件」。默认检测页面「停止 / 停止回答」按钮（aria-label 含 Stop、停止）。需同时开启「自动回车」',
        type: 'boolean',
      },
      autoEnterPollUntilSelector: {
        ...SELECTOR_META,
        label: '结束条件',
        required: false,
        desc:
          '默认已填：英文/中文停止按钮的 aria-label「包含」匹配（逗号=多条任一命中）。改关键词：把 *= 后面改成你的词，例如 button[aria-label*="完成"]；多条用英文逗号拼接。另有一层内置检测：Gemini CDK 的 aria-describedby→「停止回答」「Stop response」等（勿选 #cdk-describedby-message-* 的 div）。判定：**选择器命中 或 内置命中** 即结束',
        example: DEFAULT_TEXT_INPUT_POLL_UNTIL_SELECTOR,
      },
      autoEnterPollIntervalMs: {
        label: '轮询间隔（ms）',
        desc: '两次 Enter 之间的等待时间，默认 3000（3 秒）',
        type: 'number',
        example: '3000',
      },
      autoEnterPollMaxMs: {
        label: '最长等待（ms）',
        desc: '超过此时间仍未出现停止按钮则结束并记日志警告，默认 180000（3 分钟）',
        type: 'number',
        example: '180000',
      },
    },
  },

  {
    type: 'paste_image_clipboard',
    label: '粘贴图片',
    icon: '🖼️',
    category: 'basic',
    desc: '将图片 URL 下载后注入剪贴板，并在目标输入框执行粘贴（用于 Gemini 图片编辑）',
    defaultParams: {
      imageUrls: '{{sourceImageUrls}}',
      imageUrl: '{{sourceImageUrl}}',
      mode: 'auto',
      targetSelector: 'div[contenteditable="true"]',
      pasteHotkey: 'ControlOrMeta+V',
      ensurePageFocused: true,
      fallbackOnNoEffect: true,
      waitAfterPaste: 1200,
      // 默认开启“真校验 + 自动降级”，避免出现“日志成功但其实没上传”的假阳性
      verifyAttachment: true,
      uploadFallback: true,
      openUploaderSelector: '',
      fileInputSelector: '',
      waitAfterUpload: 2500,
      attachIndicatorSelector: '',
      outputVar: 'pastedImageUrls',
    },
    paramMeta: {
      imageUrls: {
        label: '图片 URL 数组',
        desc: '可填数组（["url1","url2"]）或逗号/换行分隔字符串。为空时自动跳过该节点',
        type: 'array',
        required: false,
        example: '["https://a.jpg","https://b.png"]',
      },
      imageUrl: {
        label: '图片 URL',
        desc: '单图兼容字段；当 imageUrls 为空时使用此值，支持 {{变量}} 模板',
        type: 'template',
        required: false,
        example: 'http://articel.oss-cn-hangzhou.aliyuncs.com/xhs/feed-covers/xx.jpg',
      },
      mode: {
        label: '执行模式',
        desc: 'auto=先尝试“剪贴板粘贴”，失败再自动上传；upload=直接上传（不走粘贴/快捷键）；paste=仅粘贴（不上传）',
        type: 'select',
        required: false,
        options: [
          { label: 'auto（推荐）', value: 'auto' },
          { label: 'upload（直接上传）', value: 'upload' },
          { label: 'paste（仅粘贴）', value: 'paste' },
        ],
        example: 'upload',
      },
      targetSelector: {
        ...SELECTOR_META,
        required: false,
        desc: '接收粘贴动作的输入框选择器（会先点击聚焦再执行 Ctrl/Cmd+V）。为空则自动定位可输入框',
      },
      pasteHotkey: {
        label: '粘贴快捷键（录入）',
        desc: '点击后直接按下组合键即可录入。Esc=恢复 auto；Backspace/Delete=清空。推荐用 ControlOrMeta+V，跨 mac/Windows/Linux 更一致；auto=mac 用 Meta+V，其它用 Control+V。也可粘贴/手填 Meta+V / Control+V / ControlOrMeta+V 等（Playwright 键盘语法）',
        type: 'hotkey',
        required: false,
        example: 'ControlOrMeta+V（推荐）或 auto',
      },
      ensurePageFocused: {
        label: '确保页面聚焦',
        desc: '默认开启。会尝试 page.bringToFront() + window.focus()，避免快捷键打到别处（AdsPower/远程调试时很常见）',
        type: 'boolean',
      },
      fallbackOnNoEffect: {
        label: '无效果时自动换键',
        desc: '默认开启。比如 Meta+V 无效时自动再试 Control+V（或相反），成功后才继续；都失败才走上传降级',
        type: 'boolean',
      },
      waitAfterPaste: {
        label: '粘贴后等待（ms）',
        desc: '执行粘贴后的额外等待时间，给 Gemini 上传附件预留缓冲',
        type: 'number',
        example: '1200',
      },
      verifyAttachment: {
        label: '校验附件出现',
        desc: '默认开启。会检测“附件缩略图/移除按钮”等是否出现；失败则触发文件上传降级（若开启）',
        type: 'boolean',
      },
      uploadFallback: {
        label: '失败自动上传文件',
        desc: '剪贴板粘贴失败或未检测到附件时，自动降级为下载到本地后通过 input[type=file] 上传',
        type: 'boolean',
      },
      openUploaderSelector: {
        label: '打开上传器按钮选择器',
        desc: '可选：例如输入框左侧的“+”按钮。若 file input 默认隐藏，可先点它再 setInputFiles',
        type: 'selector',
        required: false,
        example: 'button[aria-label*="Add"], button:has-text("+")',
      },
      fileInputSelector: {
        label: '文件输入框选择器',
        desc: '可选：上传用的 input[type=file] 选择器。不填则自动用 input[type=file]',
        type: 'selector',
        required: false,
        example: 'input[type="file"]',
      },
      waitAfterUpload: {
        label: '上传后等待（ms）',
        desc: '文件上传后的额外等待时间，给页面渲染附件缩略图预留缓冲',
        type: 'number',
        example: '2500',
      },
      attachIndicatorSelector: {
        label: '附件校验选择器（可选）',
        desc: '可选：用于更精确地校验附件出现。不填则使用内置默认规则',
        type: 'selector',
        example: 'img[src^="blob:"], [aria-label*="Remove"], [data-testid*="attachment"]',
      },
      outputVar: {
        label: '输出变量名',
        desc: '把本次粘贴的源图片 URL 数组写入此变量，供后续节点复用',
        type: 'string',
        example: 'pastedImageUrls',
      },
    },
  },

  {
    type: 'press_hotkey',
    label: '快捷键',
    icon: '⌨️',
    category: 'basic',
    desc: '聚焦到指定输入框后执行快捷键（用于验证键盘事件/选中/触发上传入口等）',
    defaultParams: {
      targetSelector: 'div[contenteditable="true"]',
      hotkey: 'ControlOrMeta+A',
      clickToFocus: true,
      ensurePageFocused: true,
      waitBefore: 0,
      waitAfter: 200,
      repeat: 1,
      verifySelection: true,
      fallbackOnNoEffect: true,
      domSelectAllFallback: true,
    },
    paramMeta: {
      targetSelector: {
        ...SELECTOR_META,
        required: false,
        desc: '可选：先聚焦该元素再按快捷键；为空则直接在当前焦点执行按键',
      },
      hotkey: {
        label: '快捷键（录入）',
        desc: '点击后直接按下组合键即可录入。也可手动填 Playwright 键盘语法（如 Alt+A / ControlOrMeta+A / Meta+V）',
        type: 'hotkey',
        required: true,
        example: 'Alt+A',
      },
      clickToFocus: {
        label: '点击以聚焦',
        desc: '默认开启。true=先 click；false=调用 focus() 聚焦（对某些元素更温和）',
        type: 'boolean',
      },
      ensurePageFocused: {
        label: '确保页面聚焦',
        desc: '默认开启。会尝试 page.bringToFront() + window.focus()，避免快捷键打到别处（AdsPower/远程调试时很常见）',
        type: 'boolean',
      },
      waitBefore: {
        label: '按键前等待（ms）',
        desc: '聚焦后，按键前额外等待时间',
        type: 'number',
        example: '0',
      },
      waitAfter: {
        label: '按键后等待（ms）',
        desc: '按键后额外等待时间',
        type: 'number',
        example: '200',
      },
      repeat: {
        label: '重复次数',
        desc: '重复按下快捷键的次数（用于连按）',
        type: 'number',
        example: '1',
      },
      verifySelection: {
        label: '校验选区变化',
        desc: '默认开启。会检测是否真的出现“选中内容”。如果没变化，将触发 fallback（例如 Meta/Control 替代、DOM 强制全选）',
        type: 'boolean',
      },
      fallbackOnNoEffect: {
        label: '无效果时自动换键',
        desc: '默认开启。比如 Meta+A 无效时自动再试 Control+A（或相反），用于排查/兼容不同浏览器映射',
        type: 'boolean',
      },
      domSelectAllFallback: {
        label: 'DOM 强制全选兜底',
        desc: '默认开启（仅对 A 生效）。在键盘无效时，直接用 Selection API 对目标元素全选，以验证“元素确实可被选中”',
        type: 'boolean',
      },
    },
  },

  {
    type: 'scroll',
    label: '滚动',
    icon: '🖱️',
    category: 'basic',
    desc: '滚动页面或滚动到指定元素，让目标区域进入视口',
    defaultParams: { y: 500, behavior: 'smooth' },
    paramMeta: {
      selector: {
        ...SELECTOR_META,
        required: false,
        desc: '滚动到此元素位置（优先于 x/y 像素滚动）。CSS 或 XPath 均可',
      },
      x: {
        label: '水平滚动（px）',
        desc: '水平方向滚动像素数，正数向右，负数向左',
        type: 'number',
        example: '0',
      },
      y: {
        label: '垂直滚动（px）',
        desc: '垂直方向滚动像素数，正数向下，负数向上',
        type: 'number',
        example: '500',
      },
      behavior: {
        label: '滚动方式',
        desc: 'smooth=平滑滚动（动画效果）；auto=立即跳转',
        type: 'string',
        example: 'smooth',
      },
    },
  },

  {
    type: 'screenshot',
    label: '截图',
    icon: '📸',
    category: 'basic',
    desc: '截取当前页面快照，结果显示在 Debug 面板中',
    defaultParams: {},
    paramMeta: {},
  },

  // ── 高级节点 ──────────────────────────────────────────────────────────────

  {
    type: 'file_upload',
    label: '文件上传',
    icon: '📤',
    category: 'advanced',
    desc: '从 URL 下载文件后注入到 input[type=file] 元素，模拟文件选择',
    defaultParams: { selector: 'input[type="file"]', url: '{{videoUrl}}' },
    paramMeta: {
      selector: {
        ...SELECTOR_META,
        desc: '文件上传 input 元素的选择器。通常是 input[type="file"] 或包含 accept 属性的 input',
      },
      url: {
        label: '文件 URL',
        desc: '要上传的文件的网络地址（OSS/CDN URL）。支持 {{变量名}} 模板，如 {{videoUrl}}',
        type: 'template',
        required: true,
        example: '{{videoUrl}} 或 https://example.com/video.mp4',
      },
    },
  },

  {
    type: 'qrcode',
    label: '扫码登录',
    icon: '📱',
    category: 'advanced',
    desc: '截取页面二维码，等待用户扫码并检测登录成功（通过 URL 跳转判断）',
    defaultParams: {
      successUrlContains: '',
      excludeUrls: [],
      cookieDomain: '',
      timeout: 300_000,
      refreshInterval: 110_000,
    },
    paramMeta: {
      selector: {
        label: '二维码元素选择器',
        desc: '自定义 CSS 选择器定位二维码图片元素，优先于内置自动检测列表。留空则按内置列表：[class*="qrcode_img"]、canvas[class*="qr"] 等自动查找',
        type: 'selector',
        example: '[class*="qrcode"] img 或 //img[@alt="二维码"]',
      },
      successUrlContains: {
        label: '成功 URL 关键词',
        desc: '扫码成功后页面会跳转，新 URL 须包含此字符串才算登录成功。例如：creator-micro（抖音创作者页）',
        type: 'string',
        required: true,
        example: 'creator-micro',
      },
      excludeUrls: {
        label: '排除 URL 列表',
        desc: '当前 URL 包含这些字符串时，认为未登录（排除登录页自身）。数组格式，如 ["/login", "qrcode"]',
        type: 'array',
        example: '["/login", "qrcode", "passport"]',
      },
      cookieDomain: {
        label: 'Cookie 域名',
        desc: '扫码成功后提取此域名下的 Cookie（用于后续验证）。留空则提取所有',
        type: 'string',
        example: 'douyin.com',
      },
      refreshInterval: {
        label: '二维码刷新间隔（ms）',
        desc: '二维码自动刷新的间隔时间（毫秒），防止二维码过期。默认 110000（约1分50秒）',
        type: 'number',
        example: '110000',
      },
      timeout: TIMEOUT_META,
    },
  },

  {
    type: 'human_pause',
    label: '人工暂停',
    icon: '🙋',
    category: 'advanced',
    desc: '暂停工作流，等待人工在浏览器中完成操作（Cloudflare 验证、滑块验证码等）',
    defaultParams: { message: '请完成浏览器中的人工验证', timeout: 300 },
    paramMeta: {
      message: {
        label: '提示语',
        desc: '显示给操作者的说明文字，告知需要做什么操作',
        type: 'string',
        example: '请点击 Cloudflare 的「我是人类」复选框',
      },
      timeout: {
        label: '超时秒数',
        desc: '最长等待时间（秒）。超时后自动继续执行下一步，不报错',
        type: 'number',
        example: '300',
      },
    },
  },

  {
    type: 'wait_condition',
    label: '等待条件',
    icon: '⏳',
    category: 'advanced',
    desc: '轮询等待指定条件成立：URL 跳转、元素出现/消失、文字检测（如进度条）',
    defaultParams: { timeout: 60_000, timeoutAction: 'continue' },
    paramMeta: {
      urlContains: {
        label: '等待 URL 包含',
        desc: '轮询检测当前 URL，直到包含此字符串为止',
        type: 'string',
        example: '/content/manage',
      },
      textMatch: {
        label: '文字正则匹配',
        desc: '用正则表达式匹配页面文字，常用于提取进度数字（如"检测中 57%"）。括号内为捕获组',
        type: 'string',
        example: '检测中\\s*(\\d+)\\s*%',
      },
      selector: {
        ...SELECTOR_META,
        required: false,
        desc: '等待此元素出现或消失（配合 condition: appeared/disappeared 使用）',
      },
      condition: {
        label: '通过条件',
        desc: '"value > 90" = 提取到的数字大于90；"appeared" = 元素出现；"disappeared" = 元素消失；"url_match" = URL 匹配',
        type: 'string',
        example: 'value > 90 | appeared | disappeared',
      },
      timeoutAction: {
        label: '超时行为',
        desc: '"continue" = 超时后继续执行下一步（忽略超时）；"fail" = 超时后报错中止',
        type: 'string',
        example: 'continue',
      },
      failKeywords: {
        label: '失败关键词',
        desc: '页面文字包含任一关键词则判定失败。数组格式，常用于检测违规/错误提示',
        type: 'array',
        example: '["违规", "发布失败", "审核不通过"]',
      },
      successKeywords: {
        label: '成功关键词',
        desc: '页面文字包含任一关键词则判定成功（优先于按钮验证）',
        type: 'array',
        example: '["作品未见异常", "检测通过"]',
      },
      verifyButtonText: {
        label: '验证按钮文字',
        desc: '检测完成后验证此按钮是否可点击，可点击则判定成功',
        type: 'string',
        example: '发布',
      },
      pollInterval: {
        label: '轮询间隔（ms）',
        desc: '每次检查条件的时间间隔（毫秒），默认 2000',
        type: 'number',
        example: '2000',
      },
      timeout: TIMEOUT_META,
    },
  },

  // ─────────────────── 高级：小红书下载 ────────────────
  {
    type: 'xhs_download',
    label: '小红书下载',
    icon: '📕',
    category: 'advanced',
    desc: '打开小红书帖子，自动翻页提取高清图片/视频并批量上传 OSS，返回 URL 数组',
    defaultParams: {
      noteUrl: '',
      cardIndex: 0,
      maxImages: 20,
      ossPrefix: 'xhs',
      outputVar: 'xhsImages',
    },
    paramMeta: {
      noteUrl: {
        label: '帖子 URL（直链）',
        desc: '小红书帖子的直接链接（如 https://www.xiaohongshu.com/explore/xxx?xsec_token=...）。填写后自动导航；留空则在当前页操作',
        type: 'url',
        example: 'https://www.xiaohongshu.com/explore/69a3a3de000000022032e66?xsec_token=xxx',
      },
      cardIndex: {
        label: '卡片序号',
        desc: '仅当当前页是小红书列表/发现页时有效：点击第几张卡片（从 0 开始）。填了 noteUrl 则此项忽略',
        type: 'number',
        example: '0',
      },
      maxImages: {
        label: '最多下载张数',
        desc: '单个帖子最多下载多少张图片（默认 20）',
        type: 'number',
        example: '20',
      },
      ossPrefix: {
        label: 'OSS 路径前缀',
        desc: '上传到 OSS 的路径前缀，最终路径为 {前缀}/{批次ID}_{序号}.jpg',
        type: 'string',
        example: 'xhs/2025',
      },
      outputVar: {
        label: '输出变量名',
        desc: '图片 OSS URL 数组将保存到此变量，后续节点可通过 {{xhsImages}} 使用',
        type: 'string',
        example: 'xhsImages',
      },
    },
  },

  // ─────────────────── 高级：提取图片 ───────────────────
  {
    type: 'extract_image',
    label: '提取图片',
    icon: '🖼️',
    category: 'advanced',
    desc: '从当前页面提取图片并上传到 OSS，返回可用的图片 URL',
    defaultParams: {
      selector: 'img',
      index: 0,
      uploadToOSS: true,
      ossPath: 'extract-images/{{timestamp}}.jpg',
      outputVar: 'imageUrl',
    },
    paramMeta: {
      selector: {
        label: '图片选择器',
        desc: 'CSS 选择器，用于匹配页面上的图片元素（默认：所有 img 标签）',
        type: 'selector',
        example: 'img.photo, .image-container img, [data-image]',
      },
      index: {
        label: '取第几个',
        desc: '如果匹配到多个图片，取第几个（从 0 开始，默认 0 即第一个）',
        type: 'number',
        example: '0',
      },
      uploadToOSS: {
        label: '上传到 OSS',
        desc: '是否将图片上传到 OSS（默认 true）。如果为 false 则只截图不上传',
        type: 'boolean',
        example: 'true',
      },
      ossPath: {
        label: 'OSS 存储路径',
        desc: 'OSS 上的存储路径，支持 {{timestamp}} 模板（默认：extract-images/{时间戳}.jpg）',
        type: 'template',
        example: 'xiaohongshu/{{title}}-{{timestamp}}.jpg',
      },
      outputVar: {
        label: '输出变量名',
        desc: '提取的图片 URL 将保存到此变量名，后续节点可通过 {{变量名}} 使用',
        type: 'string',
        example: 'imageUrl',
      },
    },
  },

  // ─────────────────── 高级：剪贴板高清图片提取（Gemini 专用）──────────
  {
    type: 'extract_image_clipboard',
    label: '📋 剪贴板高清提取',
    icon: '📋',
    category: 'advanced',
    desc: '点击页面"复制图片"按钮 → 通过系统剪贴板中转 → 保存原始分辨率 PNG → 上传 OSS。专为 Gemini 等使用 blob: URL 的平台设计，图片质量远优于截图方案',
    defaultParams: {
      copyButtonSelector: '[aria-label="Copy image"]',
      copyButtonTimeout: 60000,
      waitAfterCopy: 3000,
      failFastTextIncludes: [
        '抱歉',
        '没办法',
        '无法',
        'Something went wrong',
        'Try again',
      ],
      failFastSelector: '',
      failFastAction: 'skip_node',
      uploadToOSS: true,
      ossPath: 'gemini-images/{{timestamp}}.png',
      outputVar: 'imageUrl',
    },
    paramMeta: {
      copyButtonSelector: {
        label: '复制按钮选择器',
        desc: '触发复制的按钮的 CSS 选择器。Gemini 默认为 [aria-label="Copy image"]，其他平台可自定义',
        type: 'selector',
        example: '[aria-label="Copy image"]',
      },
      waitAfterCopy: {
        label: '等待剪贴板就绪（ms）',
        desc: '点击复制按钮后等待图片写入剪贴板的时间（毫秒）。网速慢时可适当增大，默认 3000',
        type: 'number',
        example: '3000',
      },
      copyButtonTimeout: {
        label: '复制按钮等待超时（ms）',
        desc: '等待“Copy image/复制图片”按钮出现的最长时间，默认 60000',
        type: 'number',
        example: '60000',
      },
      failFastTextIncludes: {
        label: '失败快判文本（包含即失败）',
        desc: '当页面出现这些文本片段时，立即判定失败并结束节点（减少无效等待）。例如："抱歉"、"没办法"、"Try again" 等',
        type: 'array',
        example: '["抱歉","没办法","Try again"]',
      },
      failFastSelector: {
        label: '失败快判元素选择器',
        desc: '当页面出现该 DOM 且可见时，立即判定失败并结束节点（可用于弹窗/错误条）',
        type: 'selector',
        example: '.toast-error, [role="alert"]:has-text("抱歉")',
      },
      failFastAction: {
        label: '失败快判命中后处理',
        desc: 'skip_node=跳过当前节点继续后续步骤；fail_workflow=直接让工作流失败。默认 skip_node。',
        type: 'select',
        options: [
          { label: '跳过当前节点（默认）', value: 'skip_node' },
          { label: '直接失败工作流', value: 'fail_workflow' },
        ],
        example: 'skip_node',
      },
      uploadToOSS: {
        label: '上传到 OSS',
        desc: '是否将图片上传到 OSS（默认 true）',
        type: 'boolean',
        example: 'true',
      },
      ossPath: {
        label: 'OSS 存储路径',
        desc: 'OSS 上的存储路径，支持 {{timestamp}} 模板',
        type: 'template',
        example: 'gemini-images/{{timestamp}}.png',
      },
      outputVar: {
        label: '输出变量名',
        desc: '提取的图片 URL 将保存到此变量，后续节点可通过 {{变量名}} 使用',
        type: 'string',
        example: 'imageUrl',
      },
    },
  },

  // ─────────────────── 高级：下载按钮高清提取（通用）──────────
  {
    type: 'extract_image_download',
    label: '⬇️ 下载事件提取',
    icon: '⬇️',
    category: 'advanced',
    desc: '点击页面下载按钮并捕获浏览器 Download 事件，读取原始文件后上传 OSS。避免系统剪贴板干扰，适合 Gemini/其他站点复用',
    defaultParams: {
      downloadButtonSelector: '[aria-label="Download image"], [aria-label*="Download"], [aria-label*="下载"], button:has-text("Download"), button:has-text("下载")',
      menuTriggerSelector: 'button[aria-label*="More options"], button[aria-label*="更多"]',
      menuItemSelector: '[role="menuitem"]:has-text("Download"), [role="menuitem"]:has-text("下载"), button:has-text("Download"), button:has-text("下载")',
      waitImageReady: false,
      waitImageReadyTimeout: 240000,
      waitImageReadyText: '',
      waitImageReadySelector: '',
      waitImageReadyAction: 'appeared_then_disappeared',
      waitImageReadyAppearTimeout: 30000,
      preferDomExtraction: false,
      allowDomFallback: false,
      allowClipboardFallback: true,
      serializeClipboardAccess: true,
      fallbackImageSelector: 'img[src^="blob:"], img[src^="data:image"], img',
      copyImageButtonSelector:
        'generated-image copy-button button, [aria-label="Copy image"], [aria-label*="复制图片"]',
      failFastTextIncludes: ['抱歉，今天没办法帮你生成更多视频了'],
      failFastMergeDefaultPhrases: true,
      failFastSelector: '',
      failFastAction: 'skip_node',
      buttonIndex: -1,
      buttonTimeout: 60000,
      downloadTimeout: 25000,
      maxRetries: 2,
      waitAfterClick: 500,
      minFileSizeBytes: 0,
      uploadToOSS: true,
      storageBackend: 'oss',
      localFilesUploadUrl: '',
      localFilesUploadTimeoutMs: 120000,
      ossPath: 'gemini-images/{{timestamp}}.png',
      outputVar: 'imageUrl',
    },
    paramMeta: {
      storageBackend: {
        label: '上传目标',
        desc: 'oss=阿里云 OSS（默认）；local_api=POST 到本机/内网 files:upload（multipart，快），需配置 localFilesUploadUrl 或 WORKFLOW_LOCAL_FILES_UPLOAD_URL',
        type: 'select',
        options: [
          { label: '阿里云 OSS', value: 'oss' },
          { label: '本地 files API（multipart）', value: 'local_api' },
        ],
        example: 'oss',
      },
      localFilesUploadUrl: {
        label: '本地 files 上传地址',
        desc: 'storageBackend=local_api 时使用，如 http://127.0.0.1:1002/v1beta/files:upload。可空，读环境变量 WORKFLOW_LOCAL_FILES_UPLOAD_URL',
        type: 'url',
        example: 'http://127.0.0.1:1002/v1beta/files:upload',
      },
      localFilesUploadTimeoutMs: {
        label: '本地上传超时（ms）',
        desc: 'local_api 模式 POST 超时，默认 120000',
        type: 'number',
        example: '120000',
      },
      waitImageReady: {
        label: '等待图片生成',
        desc: '开启后在提取前轮询页面，直到检测到 blob/data 图片（naturalWidth > 0）才继续。解决"发送后图片还未生成"的问题',
        type: 'boolean',
        example: 'true',
      },
      waitImageReadyTimeout: {
        label: '等待图片生成超时（ms）',
        desc: '等待图片生成的最长时间，超时后继续尝试提取。默认 240000',
        type: 'number',
        example: '240000',
      },
      waitImageReadyText: {
        label: '等待目标文字',
        desc: '页面包含此文字即匹配，比选择器更简单。与"等待目标选择器"二选一，文字优先。示例：正在加载',
        type: 'string',
        example: '正在加载',
      },
      waitImageReadySelector: {
        label: '等待目标选择器',
        desc: '当文字匹配不够精确时使用 CSS/Playwright 选择器。与"等待目标文字"二选一，文字优先',
        type: 'selector',
        example: 'model-response-message:has-text("正在加载")',
      },
      waitImageReadyAction: {
        label: '等待模式',
        desc: 'appeared_then_disappeared=等元素出现再消失（适合加载指示器）；appeared=等元素出现；disappeared=等元素消失',
        type: 'select',
        options: [
          { label: '出现再消失（加载指示器，默认）', value: 'appeared_then_disappeared' },
          { label: '等元素出现', value: 'appeared' },
          { label: '等元素消失', value: 'disappeared' },
        ],
        example: 'appeared_then_disappeared',
      },
      waitImageReadyAppearTimeout: {
        label: '等待出现超时（ms）',
        desc: 'appeared_then_disappeared 模式中等待元素出现的最长时间，超时后直接进入等消失阶段。默认 30000',
        type: 'number',
        example: '30000',
      },
      preferDomExtraction: {
        label: 'DOM 优先提取',
        desc: '开启后直接从页面 fetch blob/data 图片 buffer，跳过浏览器下载流程，大幅提速。失败时自动回退到下载按钮流程',
        type: 'boolean',
        example: 'true',
      },
      downloadButtonSelector: {
        label: '下载按钮选择器',
        desc: '用于定位触发下载的 DOM 元素，可填多个选择器逗号分隔',
        type: 'selector',
        example: '[aria-label="Download image"], button:has-text("下载")',
      },
      menuTriggerSelector: {
        label: '菜单触发按钮选择器',
        desc: '当页面没有直接下载按钮时，先点击此按钮打开菜单（如 Gemini 的 More options）',
        type: 'selector',
        example: 'button[aria-label*="More options"], button[aria-label*="更多"]',
      },
      menuItemSelector: {
        label: '菜单下载项选择器',
        desc: '菜单内真正触发下载的选项选择器',
        type: 'selector',
        example: '[role="menuitem"]:has-text("Download"), [role="menuitem"]:has-text("下载")',
      },
      allowDomFallback: {
        label: '允许 DOM 兜底',
        desc: '关闭后严格只走下载事件链路；下载失败将直接报错（推荐关闭）',
        type: 'boolean',
        example: 'false',
      },
      allowClipboardFallback: {
        label: '允许下载后剪贴板兜底',
        desc: '某些浏览器环境点击 Download 会把原图写入剪贴板而不是触发下载事件，开启后会读取该图片',
        type: 'boolean',
        example: 'true',
      },
      serializeClipboardAccess: {
        label: '串行化剪贴板访问',
        desc: '启用后会把下载点击+剪贴板读取串行执行，避免多实例并发串图（推荐开启）',
        type: 'boolean',
        example: 'true',
      },
      copyImageButtonSelector: {
        label: '复制图片按钮（下载失败优先）',
        desc:
          '未收到浏览器 Download 事件时，优先点击此按钮再读剪贴板，避免全页最大 img 误选输入区「参考图预览」（与入参同图）。可逗号多选。DOM 兜底仍会优先 model-response/generated-image 内的图',
        type: 'selector',
        example:
          'generated-image copy-button button, [aria-label*="复制图片"]',
        required: false,
      },
      fallbackImageSelector: {
        label: '兜底图片选择器',
        desc: '复制与下载均失败时，按该选择器选 img 再 fetch；内置已优先 generated-image 内大图，再全页匹配本选择器',
        type: 'selector',
        example: 'img[src^="blob:"], img[src^="data:image"], img',
      },
      failFastTextIncludes: {
        label: '失败快判文本',
        desc:
          '页面 body 文本包含任一片段即失败。勿只填 error、again 等单词（会被归一化剔除）；应写完整句如 encountered an error。已配置本项或「失败快判选择器」时，默认追加英文句 encountered an error / could you try again（见下一项）',
        type: 'array',
        example: '["抱歉，今天没办法帮你生成更多视频了","encountered an error"]',
      },
      failFastMergeDefaultPhrases: {
        label: '追加英文默认失败句',
        desc:
          '开启（默认）时在本节点关键词之外追加 Gemini 常见英文失败整句，避免仅配 error 被过滤后漏检。仅当已配置「失败快判文本」或「失败快判选择器」时生效；全空配置不会启用快判',
        type: 'boolean',
        example: 'true',
      },
      failFastSelector: {
        label: '失败快判选择器',
        desc: '页面出现该 DOM（可见）则立即失败（CSS selector）',
        type: 'selector',
        example: 'text=抱歉',
      },
      failFastAction: {
        label: '失败快判命中后处理',
        desc: 'skip_node=跳过当前节点继续后续步骤；fail_workflow=直接让工作流失败。默认 skip_node。',
        type: 'select',
        options: [
          { label: '跳过当前节点（默认）', value: 'skip_node' },
          { label: '直接失败工作流', value: 'fail_workflow' },
        ],
        example: 'skip_node',
      },
      buttonIndex: {
        label: '按钮索引',
        desc: '0=第一个，-1=最后一个（默认 -1）',
        type: 'number',
        example: '-1',
      },
      buttonTimeout: {
        label: '按钮等待超时（ms）',
        desc: '等待下载按钮出现并可点击的最长时间',
        type: 'number',
        example: '60000',
      },
      downloadTimeout: {
        label: '下载事件超时（ms）',
        desc: '点击后等待浏览器 download 事件的最长时间',
        type: 'number',
        example: '25000',
      },
      maxRetries: {
        label: '最大重试次数',
        desc: '下载失败时自动重试次数',
        type: 'number',
        example: '2',
      },
      waitAfterClick: {
        label: '点击后等待（ms）',
        desc: '点击下载按钮后额外等待时间',
        type: 'number',
        example: '500',
      },
      minFileSizeBytes: {
        label: '最小文件大小（字节）',
        desc: '用于保证高清原图：下载文件小于该值时判定失败并重试。0 表示不校验',
        type: 'number',
        example: '1500000',
      },
      uploadToOSS: {
        label: '上传到 OSS',
        desc: '是否将下载文件上传到 OSS（默认 true）',
        type: 'boolean',
        example: 'true',
      },
      ossPath: {
        label: 'OSS 存储路径',
        desc: '支持 {{timestamp}} 模板',
        type: 'template',
        example: 'gemini-images/{{timestamp}}.png',
      },
      outputVar: {
        label: '输出变量名',
        desc: '输出图片 URL 的变量名',
        type: 'string',
        example: 'imageUrl',
      },
    },
  },

  // ─────────────────── 高级：本地图片批量下载 ───────────────────
  {
    type: 'localhost_image_download',
    label: '本地图片批量下载',
    icon: '💾',
    category: 'advanced',
    desc: '从本地解析页面批量右键下载图片并上传OSS，完全绕过防盗链限制',
    defaultParams: {
      pageUrl: 'http://localhost:1007/analysis/xhs',
      imageContainerSelector: 'div.rounded-lg.overflow-hidden.border',
      imageSelector: 'img',
      maxImages: 10,
      ossPrefix: 'xhs/localhost-download',
      outputVar: 'ossImageUrls',
      downloadTimeout: 10000,
      waitTime: 3000,
    },
    paramMeta: {
      pageUrl: {
        label: '解析页面URL',
        desc: '要访问的本地解析页面地址（默认：localhost:1007/analysis/xhs）。如果当前已在目标页面，可留空',
        type: 'url',
        example: 'http://localhost:1007/analysis/xhs',
      },
      imageContainerSelector: {
        label: '图片容器选择器',
        desc: '包含图片的容器元素CSS选择器，用于批量识别图片区域',
        type: 'selector',
        example: 'div.rounded-lg.overflow-hidden.border',
      },
      imageSelector: {
        label: '图片选择器',
        desc: '图片元素的CSS选择器，在容器内查找图片',
        type: 'selector',
        example: 'img',
      },
      maxImages: {
        label: '最大下载数量',
        desc: '最多下载多少张图片（默认10张，避免下载过多）',
        type: 'number',
        example: '10',
      },
      ossPrefix: {
        label: 'OSS路径前缀',
        desc: '上传到OSS的路径前缀，最终路径为 {前缀}/{时间戳}_{文件名}',
        type: 'string',
        example: 'xhs/localhost-download',
      },
      outputVar: {
        label: '输出变量名',
        desc: 'OSS图片URL数组将保存到此变量，后续节点可通过 {{变量名}} 使用',
        type: 'string',
        example: 'ossImageUrls',
      },
      downloadTimeout: {
        label: '下载超时时间（ms）',
        desc: '单张图片下载的超时时间（毫秒），超时则跳过该图片',
        type: 'number',
        example: '10000',
      },
      waitTime: {
        label: '等待加载时间（ms）',
        desc: '页面加载后等待图片完全显示的时间（毫秒）',
        type: 'number',
        example: '3000',
      },
    },
  },

  // ─────────────────── 调试：本地图片批量下载调试 ───────────────────
  {
    type: 'localhost_image_download_debug',
    label: '本地图片下载调试',
    icon: '🔧',
    category: 'advanced',
    desc: '调试版本：检查本地解析页面的图片结构和选择器，快速诊断问题',
    defaultParams: {
      pageUrl: 'http://localhost:1007/analysis/xhs',
      imageContainerSelector: 'div.rounded-lg.overflow-hidden.border',
      imageSelector: 'img',
      maxImages: 5,
      outputVar: 'debugImageUrls',
    },
    paramMeta: {
      pageUrl: {
        label: '解析页面URL',
        desc: '要检查的本地解析页面地址',
        type: 'url',
        example: 'http://localhost:1007/analysis/xhs',
      },
      imageContainerSelector: {
        label: '图片容器选择器',
        desc: '要测试的图片容器CSS选择器',
        type: 'selector',
        example: 'div.rounded-lg.overflow-hidden.border',
      },
      imageSelector: {
        label: '图片选择器',
        desc: '要测试的图片CSS选择器',
        type: 'selector',
        example: 'img',
      },
      maxImages: {
        label: '最大检查数量',
        desc: '最多检查多少张图片（调试用，建议5张以内）',
        type: 'number',
        example: '5',
      },
      outputVar: {
        label: '输出变量名',
        desc: '调试结果保存的变量名',
        type: 'string',
        example: 'debugImageUrls',
      },
    },
  },

  // ─────────────────── 登录：平台凭证注入 ───────────────────
  {
    type: 'credential_login',
    label: '凭证登录',
    icon: '🔐',
    category: 'advanced',
    desc: '按平台+凭证ID拉取 Cookie 注入浏览器上下文。未传凭证ID时自动跳过，并打印日志。',
    defaultParams: {
      platform: 'gemini',
      credentialId: '',
      strict: false,
      outputCookieVar: 'credentialCookieStr',
    },
    paramMeta: {
      platform: {
        label: '平台',
        desc: '选择要注入 Cookie 的目标平台。',
        type: 'select',
        required: true,
        options: [
          { label: '抖音', value: 'douyin' },
          { label: '小红书', value: 'xhs' },
          { label: 'Gemini', value: 'gemini' },
        ],
      },
      credentialId: {
        label: '凭证ID',
        desc: '支持 {{变量}}。为空时自动跳过本节点。',
        type: 'template',
        example: '{{geminiClientId}}',
      },
      strict: {
        label: '严格模式',
        desc: '开启后，找不到凭证或 Cookie 无效会直接失败；关闭则跳过并继续。',
        type: 'boolean',
      },
      outputCookieVar: {
        label: 'Cookie 输出变量名',
        desc: '把注入前的原始 Cookie 字符串写入变量，供后续调试。',
        type: 'string',
        example: 'credentialCookieStr',
      },
    },
  },

  // ─────────────────── 调度：工作流作为节点调用 ───────────────────
  {
    type: 'workflow_call',
    label: '工作流调用',
    icon: '🧩',
    category: 'advanced',
    desc: '把现有工作流当作子节点执行，支持并发多次调用并汇总输出。',
    defaultParams: {
      workflowId: '',
      runs: [],
      count: '{{imageCount}}',
      instanceIds: ['k1b908rw', 'k1bdaoa7', 'k1ba8vac'],
      promptVarName: 'noteUrl',
      maxConcurrency: 3,
      minSuccess: '{{imageCount}}',
      inheritVars: true,
      outputVar: 'workflowCallUrls',
      outputDetailVar: 'workflowCallResults',
    },
    paramMeta: {
      workflowId: {
        label: '子工作流 ID',
        desc: '要调用的工作流 ID。',
        type: 'string',
        required: true,
        example: '1532bbd9-6f32-468d-b4e4-4e8c518b0949',
      },
      runs: {
        label: '调用参数列表',
        desc: 'JSON 数组，每项是一次子流程调用参数（支持 {{变量}}）。留空时将启用“按数量自动分发”模式。',
        type: 'template',
        example: '[{\"noteUrl\":\"{{prompt1}}\",\"browserInstanceId\":\"{{browser1}}\"}]',
      },
      count: {
        label: '自动分发数量',
        desc: '当 runs 为空时，按该数量生成子流程调用任务。支持 {{变量}}，如 {{imageCount}}。',
        type: 'template',
        example: '{{imageCount}}',
      },
      instanceIds: {
        label: '浏览器实例池',
        desc: '当 runs 为空时，按该实例池轮询分发 browserInstanceId。可填 JSON 数组或逗号分隔字符串。',
        type: 'template',
        example: '[\"k1b908rw\",\"k1bdaoa7\",\"k1ba8vac\"]',
      },
      promptVarName: {
        label: '提示词变量名',
        desc: '自动分发模式下，从父流程读取该变量作为每次子流程的提示词（默认 noteUrl）。',
        type: 'string',
        example: 'noteUrl',
      },
      maxConcurrency: {
        label: '最大并发数',
        desc: '同时执行多少个子流程调用。',
        type: 'number',
        example: '3',
      },
      minSuccess: {
        label: '最小成功数',
        desc: '至少成功多少次子流程调用才判定本节点成功。',
        type: 'number',
        example: '3',
      },
      inheritVars: {
        label: '继承父变量',
        desc: '开启后，子流程可读取父流程已有变量。',
        type: 'boolean',
      },
      outputVar: {
        label: 'URL 输出变量名',
        desc: '成功子流程产物 URL 数组输出变量名。',
        type: 'string',
        example: 'geminiImageUrls',
      },
      outputDetailVar: {
        label: '明细输出变量名',
        desc: '子流程执行明细输出变量名。',
        type: 'string',
        example: 'geminiBranches',
      },
    },
  },

  // ─────────────────── AIGC：Meta AI 独立执行引擎 ───────────────────
  {
    type: 'metaai_generate',
    label: 'Meta AI 智能生视频',
    icon: '🤖',
    category: 'advanced',
    desc: '自动唤起 AdsPower 浏览器，访问 Meta AI 并通过您的大段提示词生成短片，等待渲染结束后提取出本地高质量视频并全自动存入阿里云 OSS 提供直链。',
    defaultParams: {
      prompt: 'A cinematic video of...',
      outputVar: 'metaaiVideos',
    },
    paramMeta: {
      prompt: {
        label: '生成提示词',
        desc: '支持英文长短文本或包含 {{变量}}。越细致的提示词生成的视频（或图片）质量越高。',
        type: 'string',
        required: true,
        example: 'A cinematic video of a cyberpunk city...',
      },
      outputVar: {
        label: '数组输出变量名',
        desc: '执行结束后，会自动向系统变量注入这个名称的 JSON 数组（包含 4 个 OSS 永久视频链接），供发送抖音节点使用。',
        type: 'string',
        example: 'metaaiVideos',
      },
    },
  },

  // ─────────────────── AIGC：Gemini 并发多 Tab 生图 ───────────────────
  {
    type: 'gemini_parallel_generate',
    label: 'Gemini 并发生图',
    icon: '⚡',
    category: 'advanced',
    desc: '在同一浏览器实例内并发打开多个 Tab，同时提交多条提示词到 Gemini，提高总吞吐。',
    defaultParams: {
      prompts: ['A cinematic portrait, ultra detailed', 'A product shot, studio lighting', 'A sci-fi city at night'],
      url: 'https://gemini.google.com/app',
      inputSelector: 'textarea',
      preClickText: 'Create image',
      preClickSelector: '',
      submitSelector: '',
      successSelector: '[aria-label="Copy image"]',
      imageSelector: '',
      uploadToOSS: true,
      ossPath: 'gemini-images/{{timestamp}}-{{index}}.png',
      perTabTimeout: 180000,
      maxConcurrency: 3,
      minSuccess: 3,
      closeExtraTabs: true,
      outputVar: 'geminiImageUrls',
      outputDetailVar: 'geminiBranches',
    },
    paramMeta: {
      prompts: {
        label: '提示词数组',
        desc: '并发提交的提示词列表（JSON 数组）。建议 3 条，每条对应一个并发分支。',
        type: 'array',
        required: true,
        example: '["提示词1","提示词2","提示词3"]',
      },
      url: {
        label: '目标页面',
        desc: '每个并发 Tab 打开的页面地址。',
        type: 'url',
        example: 'https://gemini.google.com/app',
      },
      inputSelector: {
        label: '输入框选择器',
        desc: '用于输入提示词的元素选择器。',
        type: 'selector',
        example: 'textarea',
      },
      preClickText: {
        label: '预点击按钮文案',
        desc: '可选。每个分支提交前先点击该按钮（例如 Create image）。',
        type: 'string',
        example: 'Create image',
      },
      preClickSelector: {
        label: '预点击按钮选择器',
        desc: '可选。优先于“预点击按钮文案”。用于精确定位模式切换按钮。',
        type: 'selector',
        example: 'button[aria-label="Create image"]',
      },
      submitSelector: {
        label: '提交按钮选择器',
        desc: '可选。为空则对输入框按 Enter 提交。',
        type: 'selector',
        example: 'button[aria-label="Run"]',
      },
      successSelector: {
        label: '成功判定选择器',
        desc: '每个分支完成后必须出现的元素（默认 Copy image 按钮）。',
        type: 'selector',
        example: '[aria-label="Copy image"]',
      },
      imageSelector: {
        label: '图片 URL 选择器',
        desc: '可选。用于抓取图片 src，留空则输出当前页面 URL。',
        type: 'selector',
        example: 'img',
      },
      uploadToOSS: {
        label: '上传到 OSS',
        desc: '开启后会将每个分支提取到的图片上传 OSS，输出永久链接。',
        type: 'boolean',
      },
      ossPath: {
        label: 'OSS 存储路径',
        desc: '支持 {{timestamp}} 与 {{index}} 模板，例如 gemini-images/{{timestamp}}-{{index}}.png',
        type: 'template',
        example: 'gemini-images/{{timestamp}}-{{index}}.png',
      },
      perTabTimeout: {
        label: '单分支超时（ms）',
        desc: '每个分支等待成功信号的最大时长。',
        type: 'number',
        example: '180000',
      },
      maxConcurrency: {
        label: '并发数',
        desc: '同一时间最多并发运行多少个分支，默认 3。',
        type: 'number',
        example: '3',
      },
      minSuccess: {
        label: '最少成功数',
        desc: '成功分支数达到该阈值，节点才算成功。',
        type: 'number',
        example: '3',
      },
      closeExtraTabs: {
        label: '完成后关闭分支 Tab',
        desc: '开启后自动关闭并发过程中创建的额外 Tab。',
        type: 'boolean',
      },
      outputVar: {
        label: '图片数组变量名',
        desc: '成功分支的图片 URL 数组（JSON）写入该变量。',
        type: 'string',
        example: 'geminiImageUrls',
      },
      outputDetailVar: {
        label: '分支明细变量名',
        desc: '每个分支的 success/error 明细（JSON）写入该变量。',
        type: 'string',
        example: 'geminiBranches',
      },
    },
  },

  // ─────────────────── AIGC：Vertex AI 聚合节点 ───────────────────
  {
    type: 'topic_picker_agent',
    label: '选题 Agent',
    icon: '🧠',
    category: 'advanced',
    desc: '先通过 DailyHot skill 拉取热点并健康检查，再将候选交给 LLM 按提示词直接过滤选择最终 3-5 条选题。',
    defaultParams: {
      goal: '给我当前最具价值的三个选题',
      count: 3,
      baseUrl: 'https://dailyhotapi-hazel.vercel.app',
      sources: ['douyin', 'bilibili', 'baidu', 'toutiao', 'thepaper'],
      perSourceLimit: 20,
      evaluatorId: 'hotness-v1',
      llmProvider: 'qianwen',
      llmModel: 'qwen-turbo',
      llmBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      llmApiKeyEnv: 'QWEN_API_KEY',
      llmTemperature: 0.2,
      llmSystemPrompt:
        '你是内容选题总监。基于候选热点，按目标筛选最值得做的 3-5 个选题，优先考虑曝光潜力、播放潜力、涨粉潜力。必须输出严格 JSON。',
      llmUserPromptTemplate:
        '任务目标：{{goal}}\\n输出数量：{{count}}\\n\\n候选数据（JSON）：\\n{{candidatesJson}}\\n\\n请仅输出 JSON，结构为：{\"selected\":[{\"rank\":1,\"title\":\"\",\"source\":\"\",\"sourceName\":\"\",\"score\":0-100,\"reason\":\"\",\"expected\":{\"exposure\":0,\"plays\":0,\"fans\":0},\"url\":\"\"}],\"summary\":\"\",\"discarded\":[{\"title\":\"\",\"reason\":\"\"}]}\\n要求：selected 按优先级排序，尽量覆盖多个来源。',
      llmCandidateLimit: 80,
      outputVar: 'topicIdeas',
      outputDetailVar: 'topicIdeasDetail',
    },
    paramMeta: {
      goal: {
        label: '选题目标',
        desc: '本次选题任务目标（例如：曝光优先 / 播放优先 / 涨粉优先）。',
        type: 'template',
        example: '给我当前最具价值的三个选题，目标涨粉',
      },
      count: {
        label: '输出数量',
        desc: '最终返回选题数量，建议 3-5。',
        type: 'number',
        example: '3',
      },
      baseUrl: {
        label: 'DailyHotApi 地址',
        desc: '热点 API 基础地址，建议使用你已部署的实例。',
        type: 'url',
        example: 'https://dailyhotapi-hazel.vercel.app',
      },
      sources: {
        label: '热点来源列表',
        desc: 'JSON 数组或逗号分隔来源名（如 douyin/weibo/zhihu）。',
        type: 'array',
        example: '["douyin","weibo","zhihu"]',
      },
      perSourceLimit: {
        label: '每源抓取条数',
        desc: '每个来源最多抓取多少条候选。',
        type: 'number',
        example: '20',
      },
      evaluatorId: {
        label: '回退评估器',
        desc: '仅当 LLM 输出失败时用于回退排序，默认 hotness-v1；涨粉可选 growth-v1。',
        type: 'string',
        example: 'hotness-v1',
      },
      llmModel: {
        label: 'LLM 模型',
        desc: '选题 Agent 使用的模型名。',
        type: 'string',
        example: 'gemini-2.5-flash / qwen-plus / deepseek-chat',
      },
      llmProvider: {
        label: 'LLM 提供商',
        desc: '支持 gemini / qianwen / deepseek / openai / auto。',
        type: 'select',
        options: [
          { label: 'auto', value: 'auto' },
          { label: 'gemini', value: 'gemini' },
          { label: 'qianwen', value: 'qianwen' },
          { label: 'deepseek', value: 'deepseek' },
          { label: 'openai', value: 'openai' },
        ],
      },
      llmBaseUrl: {
        label: 'LLM 接口地址',
        desc: '模型接口 Base URL（Gemini 使用 generateContent，其他走 OpenAI 兼容 /chat/completions）。',
        type: 'url',
        example: 'Gemini: https://generativelanguage.googleapis.com/v1beta',
      },
      llmApiKeyEnv: {
        label: 'API Key 环境变量名',
        desc: '从环境变量读取 API Key，避免把密钥写入工作流参数。',
        type: 'string',
        example: 'GEMINI_API_KEY / QWEN_API_KEY / DEEPSEEK_API_KEY',
      },
      llmTemperature: {
        label: '采样温度',
        desc: '0-1 之间，越低越稳定。',
        type: 'number',
        example: '0.2',
      },
      llmSystemPrompt: {
        label: 'LLM 系统提示词',
        desc: '用于约束模型角色和输出格式。支持在工作流节点中直接修改。',
        type: 'template',
        example: '你是内容选题总监...必须输出严格 JSON。',
      },
      llmUserPromptTemplate: {
        label: 'LLM 用户提示词模板',
        desc: '支持模板变量：{{goal}} {{count}} {{candidatesJson}}。',
        type: 'template',
        example: '任务目标：{{goal}}\\n候选数据：{{candidatesJson}}\\n请仅输出 JSON...',
      },
      llmCandidateLimit: {
        label: '送入 LLM 的候选上限',
        desc: '为控制 token 成本，仅将前 N 条候选发送给模型。',
        type: 'number',
        example: '80',
      },
      outputVar: {
        label: 'TopN 输出变量',
        desc: '最终选题数组变量名（JSON 字符串）。',
        type: 'string',
        example: 'topicIdeas',
      },
      outputDetailVar: {
        label: '明细输出变量',
        desc: '评分明细变量名（JSON 字符串）。',
        type: 'string',
        example: 'topicIdeasDetail',
      },
    },
  },

  {
    type: 'agent_react',
    label: 'ReAct Agent',
    icon: '🤖',
    category: 'advanced',
    desc: '通用 LLM Agent 节点：按提示词循环调用工具/skill，最终输出结构化 JSON。',
    defaultParams: {
      systemPrompt: '你是一个严谨的工作流 Agent。',
      userPromptTemplate: '任务目标：{{goal}}',
      llmProvider: 'qianwen',
      llmModel: 'qwen-turbo',
      llmBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      llmApiKeyEnv: 'QWEN_API_KEY',
      llmTemperature: 0.2,
      tools: ['workflow.list_vars'],
      maxTurns: 4,
      responseSchema: '{"type":"object","properties":{},"additionalProperties":true}',
      outputField: '',
      outputVar: 'agentResult',
      outputDetailVar: 'agentDetail',
    },
    paramMeta: {
      systemPrompt: {
        label: '系统提示词',
        desc: '约束 Agent 角色、边界和行为原则。',
        type: 'template',
        example: '你是内容选题总监...',
      },
      userPromptTemplate: {
        label: '用户提示词模板',
        desc: '支持 {{变量}} 模板，变量来自工作流 vars。',
        type: 'template',
        example: '任务目标：{{goal}}',
      },
      tools: {
        label: '工具列表',
        desc: 'JSON 数组或逗号分隔工具名；仅可调用已注册工具。',
        type: 'array',
        example: '["dailyhot.fetch_topics","topic.evaluate_candidates"]',
      },
      maxTurns: {
        label: '最大回合数',
        desc: 'Agent 最多可进行的思考/行动轮次。',
        type: 'number',
        example: '4',
      },
      responseSchema: {
        label: '最终输出 Schema',
        desc: '用于约束 Agent 的 final.output JSON 结构。',
        type: 'template',
        example: '{"type":"object","properties":{"selected":{"type":"array"}}}',
      },
      llmProvider: {
        label: 'LLM 提供商',
        desc: '支持 gemini / qianwen / deepseek / openai / auto。',
        type: 'select',
        options: [
          { label: 'auto', value: 'auto' },
          { label: 'gemini', value: 'gemini' },
          { label: 'qianwen', value: 'qianwen' },
          { label: 'deepseek', value: 'deepseek' },
          { label: 'openai', value: 'openai' },
        ],
      },
      llmModel: {
        label: 'LLM 模型',
        desc: 'Agent 使用的模型名。',
        type: 'string',
        example: 'qwen-turbo',
      },
      llmBaseUrl: {
        label: 'LLM Base URL',
        desc: 'Gemini 使用 generateContent，其他走 OpenAI 兼容 /chat/completions。',
        type: 'url',
        example: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      },
      llmApiKeyEnv: {
        label: 'API Key 环境变量',
        desc: '从环境变量读取 API Key，避免把密钥写入工作流。',
        type: 'string',
        example: 'QWEN_API_KEY',
      },
      llmTemperature: {
        label: '采样温度',
        desc: '0-1 之间，越低越稳定。',
        type: 'number',
        example: '0.2',
      },
      outputVar: {
        label: '输出变量名',
        desc: 'final.output 写入该变量。',
        type: 'string',
        example: 'agentResult',
      },
      outputField: {
        label: '输出字段（可选）',
        desc: '若 final.output 是对象，可指定提取其中某字段写入 outputVar（例如 selected）。',
        type: 'string',
        example: 'selected',
      },
      outputDetailVar: {
        label: '明细变量名',
        desc: 'Agent 轨迹、提示词、工具调用明细写入该变量。',
        type: 'string',
        example: 'agentDetail',
      },
    },
  },

  // ─────────────────── AIGC：Vertex AI 聚合节点 ───────────────────
  {
    type: 'vertex_ai',
    label: 'Vertex AI',
    icon: '🖼️',
    category: 'advanced',
    desc: '聚合 Vertex AI 的图片生成、参考图编辑、视频生成能力，统一通过服务账号直连。',
    defaultParams: {
      capability: 'image_generate',
      prompt: 'A cinematic product photo of...',
      model: 'vertex:imagen-4.0-generate-001',
      count: 1,
      aspectRatio: '1:1',
      personGeneration: 'allow_adult',
      referenceImageUrls: '',
      sourceImageGcsUri: '',
      durationSeconds: 8,
      generateAudio: true,
      uploadToOSS: true,
      ossPath: 'vertex-assets/{{timestamp}}-{{index}}',
      outputVar: 'imageUrl',
      outputListVar: 'imageUrls',
    },
    paramMeta: {
      capability: {
        label: '能力类型',
        desc: '选择当前 Vertex 节点要执行的能力。',
        type: 'select',
        required: true,
        options: [
          { label: '文生图', value: 'image_generate' },
          { label: '参考图编辑', value: 'image_edit' },
          { label: '生视频', value: 'video_generate' },
        ],
      },
      prompt: {
        label: '生成提示词',
        desc: '支持 {{变量}} 模板。不同能力下分别作为文生图、参考图编辑、生视频的提示词。',
        type: 'template',
        required: true,
        example: 'A luxury skincare bottle on a marble table, soft daylight, premium ad shot',
      },
      model: {
        label: '模型',
        desc: '选择 Vertex Imagen 模型。当前节点只支持 Vertex 直连。',
        type: 'select',
        required: true,
        options: [
          { label: 'Vertex · imagen-3.0-generate-002', value: 'vertex:imagen-3.0-generate-002' },
          { label: 'Vertex · imagen-3.0-capability-001', value: 'vertex:imagen-3.0-capability-001' },
          { label: 'Vertex · imagen-4.0-generate-001', value: 'vertex:imagen-4.0-generate-001' },
          { label: 'Vertex · imagen-4.0-fast-generate-001', value: 'vertex:imagen-4.0-fast-generate-001' },
          { label: 'Vertex · veo-3.1-generate-001', value: 'vertex:veo-3.1-generate-001' },
          { label: 'Vertex · veo-3.0-generate-001', value: 'vertex:veo-3.0-generate-001' },
          { label: 'Vertex · veo-3.0-fast-generate-001', value: 'vertex:veo-3.0-fast-generate-001' },
          { label: 'Vertex · veo-2.0-generate-001', value: 'vertex:veo-2.0-generate-001' },
        ],
      },
      count: {
        label: '生成数量',
        desc: '图片能力下最多 4 张。视频能力固定按单条处理。',
        type: 'number',
        example: '1',
      },
      aspectRatio: {
        label: '长宽比',
        desc: 'Vertex Imagen 使用的输出比例。',
        type: 'select',
        options: [
          { label: '1:1', value: '1:1' },
          { label: '3:4', value: '3:4' },
          { label: '4:3', value: '4:3' },
          { label: '9:16', value: '9:16' },
          { label: '16:9', value: '16:9' },
          { label: '2:3', value: '2:3' },
          { label: '3:2', value: '3:2' },
          { label: '4:5', value: '4:5' },
          { label: '5:4', value: '5:4' },
          { label: '21:9', value: '21:9' },
        ],
      },
      referenceImageUrls: {
        label: '参考图 URL 列表',
        desc: '用于参考图编辑。支持 JSON 数组，或多行/逗号分隔的 URL 列表。',
        type: 'template',
        example: '["https://.../1.png"]',
      },
      sourceImageGcsUri: {
        label: '源图 GCS URI',
        desc: '用于生视频时的首帧图。当前需传 gs://bucket/path.png 形式的 GCS 路径。',
        type: 'string',
        example: 'gs://my-bucket/input/frame.png',
      },
      durationSeconds: {
        label: '视频时长（秒）',
        desc: '用于生视频，当前建议 4-8 秒。',
        type: 'number',
        example: '8',
      },
      generateAudio: {
        label: '生成音频',
        desc: '用于生视频时是否同时生成音频轨。',
        type: 'boolean',
      },
      personGeneration: {
        label: '人物生成策略',
        desc: 'Vertex Imagen 的人物生成策略。',
        type: 'select',
        options: [
          { label: 'allow_adult', value: 'allow_adult' },
          { label: 'allow_all', value: 'allow_all' },
          { label: 'dont_allow', value: 'dont_allow' },
        ],
      },
      uploadToOSS: {
        label: '上传到 OSS',
        desc: '开启后自动上传到阿里云 OSS，并输出永久地址。',
        type: 'boolean',
      },
      ossPath: {
        label: 'OSS 存储路径',
        desc: '支持 {{timestamp}} 与 {{index}} 模板，用于多图场景命名。',
        type: 'string',
        example: 'ai-images/{{timestamp}}-{{index}}.png',
      },
      outputVar: {
        label: '首个结果变量名',
        desc: '首张图片或首个视频地址写入这个变量名，便于后续节点直接使用。',
        type: 'string',
        example: 'imageUrl',
      },
      outputListVar: {
        label: '结果数组变量名',
        desc: '所有结果地址会以 JSON 数组写入这个变量名。',
        type: 'string',
        example: 'imageUrls',
      },
    },
  },
];

// ── 工具函数 ──────────────────────────────────────────────────────────────────

export function getCatalogItem(type: NodeType): NodeCatalogItem | undefined {
  return NODE_CATALOG.find(n => n.type === type);
}

export const BASIC_NODES = NODE_CATALOG.filter(n => n.category === 'basic');
export const ADVANCED_NODES = NODE_CATALOG.filter(n => n.category === 'advanced');

/** 通用参数说明（url、waitAfter 等节点级字段） */
export const NODE_LEVEL_PARAM_META: Record<string, ParamMeta> = {
  url: {
    label: '前置导航 URL',
    desc: '节点执行前自动导航到此 URL。当前页 URL 已匹配则跳过导航。留空表示不自动导航，直接在当前页面执行',
    type: 'url',
    example: 'https://creator.douyin.com/creator-micro/content/upload',
  },
};

/** 可用的模板变量（在 text_input value 等 template 类型参数中显示） */
export const WORKFLOW_VARS_META: Record<string, string> = {
  videoUrl: '视频文件地址（OSS URL）',
  title: '视频标题',
  tags: '话题标签（逗号分隔）',
  clientId: '账号 ID',
  goal: '任务目标（例如：最具价值的 3 个选题）',
  count: '输出数量（建议 3-5）',
  sources: '热点来源列表（数组或逗号分隔）',
  sourceImageUrl: '参考图 URL（单张）',
  sourceImageUrls: '参考图 URL 列表（JSON 数组或逗号分隔）',
  topicIdeas: '选题节点输出结果（JSON 字符串）',
};
