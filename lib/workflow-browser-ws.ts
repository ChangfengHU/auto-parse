/**
 * 工作流浏览器控制 WebSocket API
 * 
 * 功能：
 * 1. 维持与持久化浏览器的连接
 * 2. 定时发送浏览器截图
 * 3. 接收前端指令执行步骤
 * 4. 监听浏览器元素点击，返回选择器
 */

import { WebSocketServer } from 'ws';
import { getPersistentContext } from '@/lib/persistent-browser';
import type { Page } from 'playwright';
import type { WorkflowStep } from '@/components/workflow-visualizer';

const SCREENSHOT_INTERVAL = 1000; // 每秒截图一次

let wss: WebSocketServer | null = null;

// 存储每个连接的状态
const clients = new Map<any, {
  page: Page | null;
  screenshotTimer: NodeJS.Timeout | null;
  isPickerMode: boolean;
}>();

export function setupWorkflowBrowserWS(server: any) {
  if (wss) return;

  wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request: any, socket: any, head: any) => {
    const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
    
    if (pathname === '/api/workflow/browser') {
      wss!.handleUpgrade(request, socket, head, (ws) => {
        wss!.emit('connection', ws, request);
      });
    }
  });

  wss.on('connection', async (ws) => {
    console.log('[WorkflowBrowser] Client connected');

    try {
      // 获取持久化浏览器的页面
      const context = await getPersistentContext();
      const pages = context.pages();
      let page = pages.length > 0 ? pages[0] : await context.newPage();

      // 存储客户端状态
      const clientState = {
        page,
        screenshotTimer: null as NodeJS.Timeout | null,
        isPickerMode: false,
      };
      clients.set(ws, clientState);

      // 发送当前URL
      ws.send(JSON.stringify({
        type: 'url',
        data: page.url(),
      }));

      // 开始定时截图
      const startScreenshots = () => {
        if (clientState.screenshotTimer) {
          clearInterval(clientState.screenshotTimer);
        }

        clientState.screenshotTimer = setInterval(async () => {
          try {
            if (!page) return;
            
            const screenshot = await page.screenshot({
              type: 'png',
              fullPage: false,
            });
            
            const base64 = `data:image/png;base64,${screenshot.toString('base64')}`;
            
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({
                type: 'screenshot',
                data: base64,
              }));
            }
          } catch (e) {
            console.error('[WorkflowBrowser] Screenshot error:', e);
          }
        }, SCREENSHOT_INTERVAL);
      };

      startScreenshots();

      // 监听URL变化
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) {
          ws.send(JSON.stringify({
            type: 'url',
            data: page.url(),
          }));
        }
      });

      // 处理前端消息
      ws.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString());
          
          switch (message.type) {
            case 'navigate':
              await page.goto(message.data, { waitUntil: 'domcontentloaded' });
              break;
              
            case 'executeStep':
              await executeStep(page, message.data as WorkflowStep, ws);
              break;
              
            case 'setPickerMode':
              clientState.isPickerMode = message.data;
              if (message.data) {
                await enableElementPicker(page, ws);
              } else {
                await disableElementPicker(page);
              }
              break;
          }
        } catch (e) {
          console.error('[WorkflowBrowser] Message handler error:', e);
          ws.send(JSON.stringify({
            type: 'error',
            data: String(e),
          }));
        }
      });

      ws.on('close', () => {
        console.log('[WorkflowBrowser] Client disconnected');
        const state = clients.get(ws);
        if (state?.screenshotTimer) {
          clearInterval(state.screenshotTimer);
        }
        clients.delete(ws);
      });

    } catch (e) {
      console.error('[WorkflowBrowser] Setup error:', e);
      ws.send(JSON.stringify({
        type: 'error',
        data: '无法连接到浏览器',
      }));
      ws.close();
    }
  });
}

// 执行单个步骤
async function executeStep(page: Page, step: WorkflowStep, ws: any) {
  try {
    console.log(`[WorkflowBrowser] Executing step: ${step.name} (${step.type})`);

    switch (step.type) {
      case 'navigate':
        if (step.params?.url) {
          await page.goto(String(step.params.url), { waitUntil: 'domcontentloaded' });
        }
        break;
        
      case 'click':
        if (step.selector) {
          await page.click(step.selector, { timeout: 10000 });
        }
        break;
        
      case 'type':
        if (step.selector && step.params?.text) {
          await page.fill(step.selector, String(step.params.text), { timeout: 10000 });
        }
        break;
        
      case 'upload':
        if (step.selector && step.params?.filePath) {
          const fileInput = page.locator(step.selector);
          await fileInput.setInputFiles(String(step.params.filePath));
        }
        break;
        
      case 'wait':
        if (step.params?.timeout) {
          await page.waitForTimeout(Number(step.params.timeout));
        } else if (step.selector) {
          await page.waitForSelector(step.selector, { timeout: 30000 });
        }
        break;
    }

    ws.send(JSON.stringify({
      type: 'stepComplete',
      data: { stepId: step.id, success: true },
    }));
  } catch (e) {
    console.error(`[WorkflowBrowser] Step execution error:`, e);
    ws.send(JSON.stringify({
      type: 'stepComplete',
      data: { stepId: step.id, success: false, error: String(e) },
    }));
  }
}

// 启用元素选择器模式
async function enableElementPicker(page: Page, ws: any) {
  await page.evaluate(() => {
    // 移除旧的监听器（如果有）
    if ((window as any).__elementPickerHandler) {
      document.removeEventListener('click', (window as any).__elementPickerHandler, true);
    }

    // 创建新的监听器
    const handler = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const target = e.target as HTMLElement;
      if (!target) return;

      // 生成 CSS 选择器
      const generateSelector = (el: HTMLElement): string => {
        if (el.id) return `#${el.id}`;
        if (el.className && typeof el.className === 'string') {
          const classes = el.className.split(' ').filter(c => c.trim()).join('.');
          if (classes) return `${el.tagName.toLowerCase()}.${classes}`;
        }
        return el.tagName.toLowerCase();
      };

      // 生成 XPath
      const generateXPath = (el: HTMLElement): string => {
        if (el.id) return `//*[@id="${el.id}"]`;
        
        const parts = [];
        let current: HTMLElement | null = el;
        
        while (current && current.nodeType === Node.ELEMENT_NODE) {
          let index = 0;
          let sibling = current.previousSibling;
          
          while (sibling) {
            if (sibling.nodeType === Node.ELEMENT_NODE && sibling.nodeName === current.nodeName) {
              index++;
            }
            sibling = sibling.previousSibling;
          }
          
          const tagName = current.nodeName.toLowerCase();
          const part = index > 0 ? `${tagName}[${index + 1}]` : tagName;
          parts.unshift(part);
          
          current = current.parentElement;
        }
        
        return '/' + parts.join('/');
      };

      const data = {
        selector: generateSelector(target),
        xpath: generateXPath(target),
        tagName: target.tagName,
        text: target.textContent?.trim().slice(0, 50) || '',
      };

      // 通过 window.postMessage 发送数据（因为无法直接调用 WebSocket）
      window.postMessage({ type: '__ELEMENT_PICKED__', data }, '*');
    };

    (window as any).__elementPickerHandler = handler;
    document.addEventListener('click', handler, true);
  });

  // 监听页面的 postMessage
  page.on('console', async (msg) => {
    if (msg.type() === 'log') {
      const text = msg.text();
      if (text.startsWith('__ELEMENT_PICKED__:')) {
        try {
          const data = JSON.parse(text.slice(19));
          ws.send(JSON.stringify({
            type: 'element',
            data,
          }));
        } catch {}
      }
    }
  });

  // 另一种方式：通过 exposeFunction
  await page.exposeFunction('__sendElementData', (data: any) => {
    ws.send(JSON.stringify({
      type: 'element',
      data,
    }));
  });

  await page.evaluate(() => {
    window.addEventListener('message', (e) => {
      if (e.data.type === '__ELEMENT_PICKED__') {
        (window as any).__sendElementData(e.data.data);
      }
    });
  });
}

// 禁用元素选择器模式
async function disableElementPicker(page: Page) {
  await page.evaluate(() => {
    if ((window as any).__elementPickerHandler) {
      document.removeEventListener('click', (window as any).__elementPickerHandler, true);
      delete (window as any).__elementPickerHandler;
    }
  });
}
