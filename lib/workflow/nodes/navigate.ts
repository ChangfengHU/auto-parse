import { chromium } from 'playwright';
import type { Page, Browser } from 'playwright';
import type { NavigateParams, NodeResult, WorkflowContext } from '../types';
import { captureScreenshot } from '../utils';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function executeNavigate(
  page: Page,
  params: NavigateParams,
  ctx: WorkflowContext
): Promise<NodeResult> {
  const log: string[] = [];
  const emit = (msg: string) => {
    log.push(msg);
    ctx.emit?.('log', msg);
  };

  try {
    let activePage = page;
    let newBrowser: Browser | undefined;
    const apiKey = params.adsApiKey?.trim() || process.env.ADS_API_KEY || '';
    const preferredUrl = params.adsApiUrl?.trim() || process.env.ADS_API_URL;
    const apiUrls = Array.from(new Set([
      preferredUrl,
      'http://local.adspower.net:50325',
      'http://127.0.0.1:50325',
    ].filter(Boolean) as string[]));
    
    // 0. 特性：手动 CDP 直连方案（最高优先级，用于绕过 API 鉴权报错）
    if (params.useAdsPower && params.adsManualCdpUrl) {
      emit(`🚀 检测到手动 CDP 地址，正在跳过 API 探测进行直连...`);
      try {
        newBrowser = await chromium.connectOverCDP(params.adsManualCdpUrl);
        emit(`🔄 手动直连成功，已接管浏览器实例`);
        
        await new Promise(r => setTimeout(r, 1000));
        const contexts = newBrowser.contexts();
        if (contexts.length === 0) throw new Error('浏览器环境未就绪');
        
        const pgs = contexts[0].pages();
        activePage = pgs.length > 0 ? pgs[0] : await contexts[0].newPage();
        
        // 标记后续导航逻辑使用此 activePage
        params.useAdsPower = true; // 确保向下执行逻辑正确
      } catch (err: unknown) {
        throw new Error(`手动直连失败: ${getErrorMessage(err)}。请确认 AdsPower 已打开浏览器且 ws 地址正确。`);
      }
    } 
    // 1. 正常的 AdsPower API 探测模式 (只有在没填手动地址时才跑)
    else if (params.useAdsPower) {
      emit(`🛡 AdsPower 模式已开启，正在初始化隔离容器...`);
      const profileId = (params.adsProfileId || '').trim();
      if (!profileId) throw new Error('未提供 AdsPower 分身编号 (adsProfileId)');

      let connected = false;
      for (const apiUrl of apiUrls) {
        emit(`🔍 正在探测 AdsPower API 地址: ${apiUrl}`);
        for (const endpoint of ['/api/v1/browser/active', '/api/v1/browser/start']) {
          const urlObj = new URL(`${apiUrl}${endpoint}`);
          urlObj.searchParams.set('user_id', profileId);
          if (apiKey) {
            urlObj.searchParams.set('apikey', apiKey);
            urlObj.searchParams.set('api_key', apiKey);
          }

          try {
            const headers: Record<string, string> = apiKey
              ? {
                  Authorization: `Bearer ${apiKey}`,
                  'api-key': apiKey,
                }
              : {};

            const res = await fetch(urlObj.toString(), {
              method: 'GET',
              headers,
              signal: AbortSignal.timeout(8000),
            });
            if (!res.ok) {
              emit(`⚠️ 接口 HTTP 错误 ${res.status}: ${res.statusText}`);
              continue;
            }
            const data = await res.json() as {
              code?: number;
              msg?: string;
              data?: { ws?: { puppeteer?: string } };
            };
            emit(`📡 API 原始响应: ${JSON.stringify(data)}`);

            if (data.code !== 0) {
              emit(`❌ API 逻辑报错: ${data.msg}`);
              continue;
            }

            const wsEndpoint = data.data?.ws?.puppeteer;
            if (!wsEndpoint) {
              emit(`❌ API 返回成功但缺少 ws 地址，请确认浏览器已成功启动`);
              continue;
            }

            emit(`✅ API 校验通过，正在连接调试端点 (CDP)...`);
            newBrowser = await chromium.connectOverCDP(wsEndpoint);
            emit(`🔄 CDP 握手成功，取得浏览器控制权`);

            await new Promise(r => setTimeout(r, 1000));
            const contexts = newBrowser.contexts();
            if (contexts.length === 0) throw new Error('AdsPower 浏览器环境未就绪（无 contexts）');

            const pgs = contexts[0].pages();
            activePage = pgs.length > 0 ? pgs[0] : await contexts[0].newPage();
            connected = true;
            break;
          } catch (err: unknown) {
            emit(`⚠️ 尝试连接 ${apiUrl}${endpoint} 失败: ${getErrorMessage(err)}`);
          }
        }

        if (connected) {
          break;
        }
      }

      // --- 终极自愈逻辑：探测“幽灵端口” (Ghost Port Bypass) ---
      if (!connected) {
        const GHOST_PORT = 50638; // 从 Scrapling 脚本观测到的活跃调试端口
        emit(`🕵️  API 鉴权受挫，正在尝试嗅探幽灵端口 ${GHOST_PORT}...`);
        try {
          const ghostRes = await fetch(`http://127.0.0.1:${GHOST_PORT}/json/version`, { signal: AbortSignal.timeout(3000) });
          const ghostData = await ghostRes.json() as { webSocketDebuggerUrl?: string };
          const wsEndpoint = ghostData.webSocketDebuggerUrl;
          if (wsEndpoint) {
            emit(`🔥 发现存活的幽灵端口！正在跳过 API 进行瞬间接管...`);
            newBrowser = await chromium.connectOverCDP(wsEndpoint);
            emit(`🔄 幽灵直连成功，取得浏览器控制权`);
            
            await new Promise(r => setTimeout(r, 1000));
            const contexts = newBrowser.contexts();
            if (contexts.length === 0) throw new Error('幽灵环境未就绪');
            
            const pgs = contexts[0].pages();
            activePage = pgs.length > 0 ? pgs[0] : await contexts[0].newPage();
            
            // 强力置顶：确保 AdsPower 窗口跳入用户视野，避免被本地原生窗口遮挡
            await activePage.bringToFront().catch(() => {});
            emit(`🔄 幽灵直连成功，正在通过 AdsPower 容器执行后续操作...`);
            connected = true;
          }
        } catch (error: unknown) {
          emit(`⚠️  幽灵端口嗅探失败: ${getErrorMessage(error)}`);
        }
      }

      if (!connected) {
        throw new Error('AdsPower 唤起失败。API 鉴权失败且未发现存活的直连端口。请确保分身已手动打开。');
      }
    } else {
      emit(`ℹ️ 未开启 AdsPower，使用原生浏览器模式`);
    }

    // 2. 执行导航
    emit(`🌐 正在分身容器内导航: ${params.url}`);
    await activePage.goto(params.url, {
      waitUntil: params.waitUntil || 'domcontentloaded',
      timeout: params.timeout || 60_000, // 增加超时容错
    });
    
    // 确保页面获取焦点
    await activePage.bringToFront().catch(() => {});
    
    emit(`⌛ 缓冲等待画面绘制...`);
    await activePage.waitForTimeout(2000);
    const screenshot = await captureScreenshot(activePage);
    emit(`✅ 目标页面导航完成 (环境：${params.useAdsPower ? 'AdsPower 隔离沙盒' : '原生环境'})`);
    
    return { 
      success: true, 
      log, 
      screenshot, 
      newPage: (params.useAdsPower && params.adsProfileId) ? activePage : undefined, 
      newBrowser 
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    emit(`❌ 导航失败: ${error}`);
    const screenshot = await captureScreenshot(page).catch(() => undefined);
    return { success: false, log, error, screenshot };
  }
}
