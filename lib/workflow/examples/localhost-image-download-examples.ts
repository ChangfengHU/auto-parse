/**
 * 小红书localhost图片批量下载工作流示例
 *
 * 该工作流演示如何使用localhost_image_download节点
 * 从本地解析页面批量下载图片并上传到OSS
 */

export const localhostImageDownloadWorkflow = {
  id: 'xhs-localhost-image-download',
  name: '小红书本地图片批量下载',
  description: '访问本地解析页面，批量右键下载已解析的小红书图片并上传OSS',
  vars: [], // 不需要外部变量
  nodes: [
    // 1. 导航到解析页面（如果需要）
    {
      id: 'navigate-to-analysis',
      type: 'navigate',
      label: '导航到小红书解析页面',
      params: {
        url: 'http://localhost:1007/analysis/xhs',
        waitUntil: 'networkidle',
        timeout: 30000
      },
      autoScreenshot: true
    },

    // 2. 等待页面加载完成
    {
      id: 'wait-for-images',
      type: 'wait_condition',
      label: '等待图片加载完成',
      params: {
        selector: '.rounded-xl.overflow-hidden.border img',
        action: 'appeared',
        timeout: 15000
      },
      autoScreenshot: true
    },

    // 3. 批量下载图片
    {
      id: 'download-images',
      type: 'localhost_image_download',
      label: '批量下载本地解析的图片',
      params: {
        pageUrl: 'http://localhost:1007/analysis/xhs',
        imageContainerSelector: '.rounded-xl.overflow-hidden.border',
        imageSelector: 'img',
        maxImages: 10,
        ossPrefix: 'xhs/localhost-download',
        outputVar: 'downloadedImages',
        downloadTimeout: 15000,
        waitTime: 3000
      },
      autoScreenshot: true
    },

    // 4. 截图记录结果
    {
      id: 'final-screenshot',
      type: 'screenshot',
      label: '记录下载完成状态',
      params: {},
      autoScreenshot: true
    }
  ]
};

/**
 * 快速版本：直接在当前页面下载图片
 * 适用于已经在解析页面的情况
 */
export const quickLocalhostDownloadWorkflow = {
  id: 'quick-localhost-download',
  name: '快速本地图片下载',
  description: '直接在当前页面下载图片（适用于已经在解析页面的情况）',
  vars: [],
  nodes: [
    // 只包含下载步骤
    {
      id: 'quick-download',
      type: 'localhost_image_download',
      label: '快速下载当前页面图片',
      params: {
        maxImages: 20,
        ossPrefix: 'xhs/quick-download',
        outputVar: 'quickDownloadResults',
        downloadTimeout: 10000,
        waitTime: 2000
      },
      autoScreenshot: true
    }
  ]
};

/**
 * 自定义选择器版本
 * 用于不同页面结构的图片下载
 */
export const customSelectorDownloadWorkflow = {
  id: 'custom-selector-download',
  name: '自定义选择器图片下载',
  description: '使用自定义选择器下载特定区域的图片',
  vars: ['containerSelector', 'imageSelector'], // 支持自定义选择器
  nodes: [
    {
      id: 'custom-download',
      type: 'localhost_image_download',
      label: '使用自定义选择器下载图片',
      params: {
        imageContainerSelector: '{{containerSelector}}',
        imageSelector: '{{imageSelector}}',
        maxImages: 15,
        ossPrefix: 'xhs/custom-selector',
        outputVar: 'customDownloadResults',
        downloadTimeout: 12000,
        waitTime: 2500
      },
      autoScreenshot: true
    }
  ]
};