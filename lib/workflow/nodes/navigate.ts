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
    const explicitProxyServer = params.adsProxyServer?.trim() || process.env.ADS_FORCE_PROXY_SERVER?.trim() || '';
    let effectiveProxyServer = explicitProxyServer;

    if (params.useAdsPower && !effectiveProxyServer) {
      const profileId = (params.adsProfileId || '').trim();
      if (profileId) {
        for (const apiUrl of apiUrls) {
          try {
            const urlObj = new URL(`${apiUrl}/api/v1/user/list`);
            urlObj.searchParams.set('user_id', profileId);
            if (apiKey) {
              urlObj.searchParams.set('apikey', apiKey);
              urlObj.searchParams.set('api_key', apiKey);
            }
            const headers: Record<string, string> = apiKey
              ? { Authorization: `Bearer ${apiKey}`, 'api-key': apiKey }
              : {};
            const res = await fetch(urlObj.toString(), {
              method: 'GET',
              headers,
              signal: AbortSignal.timeout(5000),
            });
            if (!res.ok) continue;
            const data = await res.json() as {
              code?: number;
              data?: { list?: Array<{ user_proxy_config?: Record<string, unknown> }> };
            };
            if (data.code !== 0) continue;
            const cfg = data.data?.list?.[0]?.user_proxy_config;
            const host = typeof cfg?.proxy_host === 'string' ? cfg.proxy_host.trim() : '';
            const port = typeof cfg?.proxy_port === 'string' ? cfg.proxy_port.trim() : '';
            const proxyType = typeof cfg?.proxy_type === 'string' ? cfg.proxy_type.trim().toLowerCase() : '';
            if (host && port) {
              const scheme = proxyType === 'socks5' ? 'socks5' : 'http';
              effectiveProxyServer = `${scheme}://${host}:${port}`;
              emit(`🧭 已从分身配置推导代理: ${effectiveProxyServer}`);
              break;
            }
          } catch {
            // ignore inference failure and continue with next API URL
          }
        }
      }
    }

    const manualCdpUrl = (params.adsManualCdpUrl || '').trim();
    const hasManualCdp = !!manualCdpUrl && !manualCdpUrl.includes('{{');
    // 0. 特性：手动 CDP 直连方案（最高优先级，用于绕过 API 鉴权报错）
    if (params.useAdsPower && hasManualCdp) {
      emit(`🚀 检测到手动 CDP 地址，正在跳过 API 探测进行直连...`);
      try {
        newBrowser = await chromium.connectOverCDP(manualCdpUrl);
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
      const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

      let connected = false;
      // 配额安全策略：仅复用已激活分身，绝不自动 start，避免触发 AdsPower 启动/创建额度。
      const endpointOrder = ['/api/v1/browser/active'];
      for (const apiUrl of apiUrls) {
        emit(`🔍 正在探测 AdsPower API 地址: ${apiUrl}`);
        emit(`🧮 配额保护已启用：仅调用 browser/active，不自动启动分身`);
        let rateLimited = false;
        let gotAuthoritativeActiveState = false;
        for (const endpoint of endpointOrder) {
          const urlObj = new URL(`${apiUrl}${endpoint}`);
          urlObj.searchParams.set('user_id', profileId);
          if (apiKey) {
            urlObj.searchParams.set('apikey', apiKey);
            urlObj.searchParams.set('api_key', apiKey);
          }

          const headers: Record<string, string> = apiKey
            ? {
                Authorization: `Bearer ${apiKey}`,
                'api-key': apiKey,
              }
            : {};

          for (let activeTry = 1; activeTry <= 3; activeTry += 1) {
            try {
              const res = await fetch(urlObj.toString(), {
                method: 'GET',
                headers,
                signal: AbortSignal.timeout(8000),
              });
              if (!res.ok) {
                emit(`⚠️ 接口 HTTP 错误 ${res.status}: ${res.statusText}`);
                break;
              }
              const data = await res.json() as {
                code?: number;
                msg?: string;
                data?: { status?: string; ws?: { puppeteer?: string } };
              };
              emit(`📡 API 原始响应: ${JSON.stringify(data)}`);

              if (data.code !== 0) {
                const msg = String(data.msg || '').toLowerCase();
                if ((msg.includes('too many request') || msg.includes('too many requests')) && activeTry < 3) {
                  emit(`⏳ AdsPower 接口限流，${activeTry}/2 次退避后重试...`);
                  await sleep(1200 * activeTry);
                  continue;
                }
                if (msg.includes('too many request') || msg.includes('too many requests')) {
                  rateLimited = true;
                }
                emit(`❌ API 逻辑报错: ${data.msg}`);
                break;
              }
              gotAuthoritativeActiveState = true;

              const wsEndpoint = data.data?.ws?.puppeteer;
              if (!wsEndpoint) {
                const status = String(data.data?.status || '').toLowerCase();
                if (status === 'inactive' && activeTry < 3) {
                  emit(`⏳ 分身状态 Inactive，${activeTry}/2 次短轮询后重试...`);
                  await sleep(1200 * activeTry);
                  continue;
                }
                emit(`❌ API 返回成功但缺少 ws 地址，请确认浏览器已成功启动`);
                break;
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
              break;
            }
          }
          if (connected) break;
        }

        if (connected) {
          break;
        }
        if (gotAuthoritativeActiveState) {
          // 已拿到 active 接口的有效状态，避免继续打别名地址造成额外限流。
          break;
        }
        if (rateLimited) {
          emit('⏳ AdsPower 接口当前限流，跳过多地址探测，稍后再由会话重试接管');
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
        throw new Error('AdsPower 分身未激活或不可用。已禁用自动启动（配额保护），请先在 AdsPower 中手动打开分身后重试。');
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
