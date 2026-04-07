/**
 * Meta AI 图片/视频智能批量下载节点
 * 
 * 核心特性：
 * - 支持持续对话场景，自动区分新/旧下载按钮
 * - 通过图片唯一 URL 判断是否已下载（如 /create/1077621618768025）
 * - 支持等待新按钮出现（生成中场景）
 * - 上传到 OSS 并返回 URL 列表
 * - 新 session 自动重置基线
 * - 记录每个图片的 ID、Animate 按钮选择器、OSS 地址的关联关系
 */
import type { Page } from 'playwright';
import path from 'path';
import fs from 'fs';
import { uploadFromFile } from '@/lib/oss';
import type { NodeResult, WorkflowContext, MetaAIDownloadParams } from '../types';

interface ButtonInfo {
  x: number;               // 按钮中心 X
  y: number;               // 按钮中心 Y
  uniqueId: string;        // 唯一标识（优先使用 /create/{id}，兜底用按钮 index）
  index: number;
  animateIndex: number;    // Animate 在可见按钮列表中的索引
  animateSelector: string; // Animate 按钮选择器（稳定：button[aria-label="Animate"]:visible + nth）
}

interface ImageInfo {
  id: string;              // 图片内容 ID（如 1077621618768025）
  animateSelector: string; // Animate 按钮的 CSS 选择器
  animateNth: number;      // Animate 按钮第几个匹配
  ossUrl: string;          // OSS 地址
}

/** 
 * 获取所有下载按钮及其关联的 Animate 按钮选择器
 * 使用下载文件名中的 ID 作为唯一标识（如 image-1077621618768025.jpeg → 1077621618768025）
 */
async function getDownloadButtons(page: Page, emit: (msg: string) => void): Promise<ButtonInfo[]> {
  emit(`🔍 开始查找下载按钮...`);
  emit(`📍 当前页面: ${page.url()}`);
  
  // 使用 page.evaluate 在浏览器内部直接查找
  const buttonData = await page.evaluate(() => {
    const btns = document.querySelectorAll('[aria-label="Download"]');
    return Array.from(btns).map((btn, i) => {
      const rect = btn.getBoundingClientRect();

      const container =
        btn.closest('.group\\/media-item') ||
        btn.closest('[class*="media-item"]') ||
        btn.closest('div');

      const visibleAnimateButtons = Array.from(document.querySelectorAll('button'))
        .filter((b) => {
          const txt = (b.textContent || '').trim();
          const r = b.getBoundingClientRect();
          return /animate/i.test(txt) && r.width > 0 && r.height > 0;
        });

      const animateBtn = container
        ? visibleAnimateButtons.find((b) => container.contains(b))
        : undefined;
      const animateIndex = animateBtn ? visibleAnimateButtons.indexOf(animateBtn) : -1;
      const animateSelector = animateIndex >= 0 ? 'button:has-text("Animate")' : '';

      const mediaLink = container?.querySelector('a[aria-label="View media"][href*="/create/"]');
      const href = mediaLink?.getAttribute('href') || '';
      const contentId = href.match(/\/create\/(\d+)/)?.[1] || '';
      
      return {
        index: i,
        x: Math.round(rect.x + rect.width / 2),
        y: Math.round(rect.y + rect.height / 2),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        visible: rect.width > 0 && rect.height > 0,
        contentId,
        animateSelector: animateSelector || '', // 如果没找到就留空
        hasAnimate: animateIndex >= 0,
        animateIndex
      };
    });
  });
  
  emit(`✅ 页面内找到 ${buttonData.length} 个 Download 按钮`);
  
  const buttonInfos: ButtonInfo[] = [];
  
  for (const data of buttonData) {
    if (data.visible) {
      const animateInfo = data.hasAnimate ? `✅ ${data.animateSelector}` : '❌ 无';
      emit(`  📍 按钮[${data.index}] 坐标 (${data.x}, ${data.y}), Animate: ${animateInfo}`);
      buttonInfos.push({
        x: data.x,
        y: data.y,
        uniqueId: data.contentId || `btn_${data.index}`,
        index: data.index,
        animateIndex: data.animateIndex,
        animateSelector: data.animateSelector
      });
    }
  }
  
  emit(`📊 可见按钮: ${buttonInfos.length} 个`);
  return buttonInfos;
}

/**
 * 通过 JS 在浏览器内直接触发下载按钮点击
 * 最可靠的方法：scrollIntoView + 触发 hover + JS click
 */
async function downloadByIndex(page: Page, index: number, emit: (msg: string) => void): Promise<boolean> {
  try {
    // 1. 滚动到按钮位置（视口中心）
    await page.evaluate((idx) => {
      const btn = document.querySelectorAll('[aria-label="Download"]')[idx];
      if (btn) {
        btn.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }, index);
    await page.waitForTimeout(500);
    
    // 2. 触发父容器的 hover 效果（让下载按钮显示在上层）
    await page.evaluate((idx) => {
      const btn = document.querySelectorAll('[aria-label="Download"]')[idx];
      if (btn) {
        const container = btn.closest('div[class*="group"]') || btn.parentElement;
        if (container) {
          container.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true }));
          container.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
        }
      }
    }, index);
    await page.waitForTimeout(300);
    emit(`    🖱️ 已触发 hover 效果`);
    
    // 3. JS 点击按钮
    const clicked = await page.evaluate((idx) => {
      const btn = document.querySelectorAll('[aria-label="Download"]')[idx];
      if (btn) {
        (btn as HTMLElement).click();
        return true;
      }
      return false;
    }, index);
    
    return clicked;
  } catch (e) {
    emit(`    ⚠️ JS 点击失败: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

export async function executeMetaAIDownload(
  page: Page,
  params: MetaAIDownloadParams,
  ctx: WorkflowContext
): Promise<NodeResult> {
  const log: string[] = [];
  const outputVar = params.outputVar || 'metaaiImages';
  const maxCount = params.maxCount || 4;
  const waitForLoad = params.waitForLoad ?? 3000;
  const waitForNewButtons = params.waitForNewButtons ?? false;
  const newButtonTimeout = params.newButtonTimeout ?? 120000;
  const baselineVar = params.baselineVar || '_metaai_baseline';
  const resetBaseline = params.resetBaseline ?? false;

  // 辅助函数：同时记录到 log 数组和实时发送到前端
  const emit = (msg: string) => {
    log.push(msg);
    ctx.emit?.('log', msg);
  };

  try {
    emit(`🎨 Meta AI 智能下载节点启动`);
    emit(`📋 配置: 最多 ${maxCount} 个, 等待新按钮: ${waitForNewButtons}, 重置基线: ${resetBaseline}`);

    // 1. 等待页面稳定
    await page.waitForTimeout(waitForLoad);

    // 2. 滚动到底部确保内容加载
    emit(`📜 滚动页面...`);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);

    // 3. 获取或重置基线
    let baselineIds: string[] = [];
    if (resetBaseline) {
      emit(`🔄 重置基线（新 session）`);
      ctx.vars[baselineVar] = '[]';
    } else if (ctx.vars[baselineVar]) {
      try {
        baselineIds = JSON.parse(ctx.vars[baselineVar]);
        emit(`📊 读取历史基线: ${baselineIds.length} 个已下载图片`);
        if (baselineIds.length > 0) {
          emit(`   示例 ID: ${baselineIds.slice(0, 3).join(', ')}...`);
        }
      } catch { 
        emit(`⚠️ 基线数据格式错误，重置为空`);
        baselineIds = [];
      }
    }

    // 4. 获取当前页面所有按钮
    let currentButtons = await getDownloadButtons(page, emit);

    // 5. 如果需要等待新按钮
    if (waitForNewButtons) {
      const startCount = currentButtons.length;
      const startTime = Date.now();
      
      emit(`⏳ 等待新按钮出现（当前 ${startCount} 个，超时 ${newButtonTimeout/1000}s）...`);
      
      while (Date.now() - startTime < newButtonTimeout) {
        await page.waitForTimeout(3000);
        
        // 滚动到底部触发加载
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(500);
        
        // 静默检查，不打印日志
        const silentEmit = () => {};
        currentButtons = await getDownloadButtons(page, silentEmit);
        
        if (currentButtons.length > startCount) {
          emit(`✅ 检测到新按钮! ${startCount} → ${currentButtons.length}`);
          break;
        }
        
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        emit(`  ⏳ ${elapsed}s: 仍有 ${currentButtons.length} 个按钮...`);
      }
    }

    // 6. 找出新增的按钮（不在基线中的，基于唯一 ID）
    const newButtons = currentButtons.filter(btn => !baselineIds.includes(btn.uniqueId));
    emit(`🆕 新增按钮: ${newButtons.length} 个 (过滤掉 ${baselineIds.length} 个已处理)`);

    if (newButtons.length === 0) {
      emit(`⚠️ 没有新的下载按钮`);
      return {
        success: true,
        log,
        output: { [outputVar]: [] },
        error: '没有新的内容需要下载'
      };
    }

    // 7. 只下载新按钮（最多 maxCount 个）
    const toDownload = newButtons.slice(-maxCount);
    emit(`⬇️ 准备下载 ${toDownload.length} 个新结果...`);

    // 准备下载目录
    const tempDir = path.join(process.cwd(), 'temp', 'metaai_downloads');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const downloadedFiles: string[] = [];
    const imageInfoList: ImageInfo[] = []; // 存储每个图片的完整信息
    const processedIds: string[] = [...baselineIds];

    // 8. 依次下载（使用 JS 直接点击，最稳定）
    for (let i = 0; i < toDownload.length; i++) {
      const btnInfo = toDownload[i];
      try {
        emit(`  📥 [${i + 1}/${toDownload.length}] 按钮[${btnInfo.index}]...`);
        
        // 等待下载事件，同时触发点击
        const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
        const clicked = await downloadByIndex(page, btnInfo.index, emit);
        
        if (!clicked) {
          emit(`    ❌ 按钮不存在或点击失败`);
          processedIds.push(btnInfo.uniqueId);
          continue;
        }
        
        const download = await downloadPromise;
        const suggestedName = download.suggestedFilename();
        
        // 从文件名提取真实 ID（如 image-1077621618768025.jpeg → 1077621618768025）
        const realId = suggestedName.match(/image-(\d+)/)?.[1] || `unknown_${Date.now()}`;
        
        const destPath = path.join(tempDir, `${Date.now()}_${i + 1}_${suggestedName}`);
        await download.saveAs(destPath);
        
        const fileSizeKB = Math.round(fs.statSync(destPath).size / 1024);
        emit(`    ✅ ${suggestedName} (${fileSizeKB} KB)`);
        emit(`       ID: ${realId}`);
        emit(`       Animate: ${btnInfo.animateSelector} (nth=${btnInfo.animateIndex})`);
        
        downloadedFiles.push(destPath);
        processedIds.push(realId); // 使用真实 ID 而不是临时 ID
        
        // 暂存下载信息（等待上传后填充 OSS URL）
        imageInfoList.push({
          id: realId,
          animateSelector: btnInfo.animateSelector,
          animateNth: btnInfo.animateIndex,
          ossUrl: '' // 稍后填充
        });

        await page.waitForTimeout(500);
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        emit(`    ❌ 下载失败: ${errMsg}`);
        // 失败时也要记录（避免重复尝试），使用临时 ID
        processedIds.push(`failed_${btnInfo.index}_${Date.now()}`);
      }
    }

    // 9. 更新基线（记录已下载的图片 ID）
    ctx.vars[baselineVar] = JSON.stringify(processedIds);
    emit(`📊 更新基线: ${processedIds.length} 个图片 ID 已记录`);
    if (processedIds.length > baselineIds.length) {
      const newIds = processedIds.slice(baselineIds.length);
      emit(`   新增: ${newIds.join(', ')}`);
    }

    if (downloadedFiles.length === 0) {
      return { success: false, log, error: '所有下载尝试均失败' };
    }

    // 10. 上传到 OSS 并填充图片信息
    emit(`\n☁️ 上传到 OSS...`);
    for (let i = 0; i < downloadedFiles.length; i++) {
      const file = downloadedFiles[i];
      try {
        const ext = path.extname(file) || '.jpg';
        const ossKey = `metaai/${Date.now()}_${i}${ext}`;
        
        const url = await uploadFromFile(file, ossKey);
        
        // 填充 OSS URL
        if (imageInfoList[i]) {
          imageInfoList[i].ossUrl = url;
        }
        
        emit(`  ✅ [${i+1}/${downloadedFiles.length}] ${url}`);
        
        fs.unlinkSync(file);
      } catch (upErr) {
        emit(`  ❌ 上传失败: ${String(upErr)}`);
      }
    }

    // 11. 存储结果（完整的图片信息数组）
    ctx.vars[outputVar] = JSON.stringify(imageInfoList);
    emit(`\n🎉 完成! 下载 ${downloadedFiles.length} 个, 上传 ${imageInfoList.filter(img => img.ossUrl).length} 个`);
    emit(`\n📦 返回数据结构示例:`);
    if (imageInfoList.length > 0) {
      emit(`   ${JSON.stringify(imageInfoList[0], null, 2)}`);
    }

    return {
      success: true,
      log,
      output: { [outputVar]: imageInfoList } // 返回完整的图片信息数组
    };

  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    emit(`❌ 节点失败: ${errorMsg}`);
    return { success: false, log, error: errorMsg };
  }
}
