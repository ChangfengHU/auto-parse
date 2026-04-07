/**
 * 节点目录 — 所有可用节点的元数据、默认参数、参数说明
 */
import type { NodeType } from './types';

export interface ParamMeta {
  label: string       // 显示名称
  desc: string        // 悬浮说明
  type: 'string' | 'number' | 'boolean' | 'selector' | 'url' | 'template' | 'array' | 'select'
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
      adsProxyServer: ''
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
      timeout: TIMEOUT_META,
    },
  },


  {
    type: 'click',
    label: '点击',
    icon: '👆',
    category: 'basic',
    desc: '点击页面上的按钮或链接。优先用 text（文字定位），其次用 selector',
    defaultParams: { text: '', selector: '', useSelector: false },
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
    defaultParams: { selector: '', value: '' },
    paramMeta: {
      selector: SELECTOR_META,
      value: {
        label: '输入内容',
        desc: '要填入的文本。支持 {{变量名}} 模板，变量从"发布参数"中自动获取。例如：{{title}} 会替换为实际标题',
        type: 'template',
        required: true,
        example: '{{title}} 或 固定文本',
      },
      clear: {
        label: '先清空',
        desc: '填入前是否先清空输入框内容（默认 true）',
        type: 'boolean',
      },
      delay: {
        label: '输入延迟（ms/字符）',
        desc: '每个字符之间的延迟毫秒数，模拟人工打字节奏。0=瞬间填入（默认）',
        type: 'number',
        example: '50',
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
      waitAfterCopy: 3000,
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
};
