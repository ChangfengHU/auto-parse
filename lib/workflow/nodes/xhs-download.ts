/**
 * xhs_download 节点 — 小红书帖子图片/视频批量下载并上传 OSS
 *
 * 流程：
 *  1. 若给了 noteUrl → 先导航过去；否则在当前页操作
 *  2. 若当前是列表页（/explore 无帖子 URL 参数）→ 点击第 cardIndex 张卡片
 *  3. 等待帖子详情加载（监听 XHS CDN 网络响应）
 *  4. 轮播逐张滑动，把全部幻灯片图片都触发加载
 *  5. 去重后按大小过滤（> 30 KB），下载并上传 OSS
 *  6. 若帖子是视频，同时提取 <video src>
 */

import type { Page, Response } from 'playwright';
import type { NodeResult, WorkflowContext } from '../types';
import type { XhsDownloadParams } from '../types';
import { captureScreenshot } from '../utils';
import { uploadBuffer } from '../../oss';

/** XHS 图片 CDN 域名特征 */
function isXhsImageUrl(url: string) {
  return (
    (url.includes('xhscdn.com') || url.includes('ci.xiaohongshu.com') || url.includes('sns-img'))
    && !url.includes('/avatar/')
    && !url.includes('/profile/')
    && !url.includes('ico')
  );
}

/** 尝试提升 URL 质量：去掉小红书 CDN 的压缩后缀，拿原图 */
function toOriginalUrl(url: string): string {
  // 移除 !xxx 压缩指令，如 !nd_dft_wlteh_jpg_3
  return url.replace(/![a-z0-9_]+$/i, '');
}

export async function executeXhsDownload(
  page: Page,
  params: XhsDownloadParams,
  ctx: WorkflowContext
): Promise<NodeResult> {
  const log: string[] = [];

  // ── 1. 解析参数 ────────────────────────────────────────────────────────────
  const noteUrl    = params.noteUrl?.trim();
  const cardIndex  = params.cardIndex  ?? 0;
  const maxImages  = params.maxImages  ?? 20;
  const ossPrefix  = (params.ossPrefix ?? 'xhs').replace(/\/$/, '');
  const outputVar  = params.outputVar  ?? 'xhsImages';

  // 用于 OSS 路径的批次 ID
  const batchId = Date.now().toString(36);

  // ── 2. 设置网络响应拦截，提前挂钩捕获高清图 ──────────────────────────────
  const capturedBuffers = new Map<string, Buffer>();

  const onResponse = async (resp: Response) => {
    const url = resp.url();
    if (!isXhsImageUrl(url)) return;
    if (!resp.ok()) return;
    try {
      const buf = await resp.body();
      // 只保留 > 30 KB 的（跳过缩略图）
      if (buf.length > 30_000) {
        capturedBuffers.set(url, buf);
      }
    } catch { /* 忽略已取消的响应 */ }
  };

  page.on('response', onResponse);

  try {
    // ── 3. 导航或点击卡片 ────────────────────────────────────────────────────
    if (noteUrl) {
      log.push(`🌐 导航到帖子：${noteUrl}`);
      ctx.emit?.('log', `🌐 正在打开小红书帖子...`);
      await page.goto(noteUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(2_000);
    } else {
      // 判断当前是否已在帖子详情（URL 包含帖子 ID 特征）
      const curUrl = page.url();
      const isDetail = /explore\/[0-9a-f]{20,}/.test(curUrl);

      if (!isDetail) {
        log.push(`🖱️ 点击第 ${cardIndex + 1} 张卡片...`);
        ctx.emit?.('log', `🖱️ 点击卡片，打开帖子详情...`);

        // 找到所有帖子卡片并点击目标
        const cards = page.locator('section.note-item, [class*="note-item"], .feeds-page a[href*="explore/"]');
        const count = await cards.count();
        if (count === 0) throw new Error('当前页面未发现帖子卡片，请先导航到小红书列表页');
        const idx = Math.min(cardIndex, count - 1);
        await cards.nth(idx).click();
        await page.waitForTimeout(2_500);
      }
    }

    // ── 4. 等待帖子详情加载 ──────────────────────────────────────────────────
    log.push(`⏳ 等待帖子图片加载...`);
    ctx.emit?.('log', `⏳ 等待小红书帖子图片加载...`);

    // 等待至少一张 CDN 图片出现在 DOM
    try {
      await page.waitForFunction(
        () => {
          const imgs = Array.from(document.querySelectorAll('img'));
          return imgs.some(img =>
            (img.src.includes('xhscdn.com') || img.src.includes('sns-img') || img.src.includes('ci.xiaohongshu.com'))
            && !img.src.includes('avatar')
          );
        },
        { timeout: 12_000 }
      );
    } catch {
      log.push('⚠️ 等待 CDN 图片超时，尝试继续...');
    }

    await page.waitForTimeout(1_000);

    // ── 5. 轮播：逐张点击"下一张"，把所有幻灯片图片触发加载 ────────────────
    log.push(`🎠 遍历轮播图片...`);

    // 先获取总张数（通过分页点/数字提示）
    const totalSlides = await page.evaluate(() => {
      // 方式1：找 "1/N" 格式的文字
      const counter = document.querySelector('[class*="count"], [class*="slide-num"], .num');
      if (counter) {
        const m = counter.textContent?.match(/\d+\s*\/\s*(\d+)/);
        if (m) return parseInt(m[1], 10);
      }
      // 方式2：数分页点
      const dots = document.querySelectorAll('[class*="dot"], [class*="bullet"], [class*="indicator"]');
      if (dots.length > 1) return dots.length;
      // 方式3：数 swiper slide
      const slides = document.querySelectorAll('.swiper-slide:not(.swiper-slide-duplicate)');
      if (slides.length > 0) return slides.length;
      return 1;
    }).catch(() => 1);

    log.push(`📊 共 ${totalSlides} 张幻灯片`);

    for (let slide = 1; slide < Math.min(totalSlides, maxImages); slide++) {
      // 点击"下一张"按钮
      const moved = await page.evaluate(() => {
        const selectors = [
          '.swiper-button-next',
          '[class*="right-arrow"]',
          '[class*="next-btn"]',
          '[class*="slide-next"]',
          '[aria-label="下一张"]',
          '[aria-label="Next"]',
        ];
        for (const sel of selectors) {
          const btn = document.querySelector(sel) as HTMLElement | null;
          if (btn && getComputedStyle(btn).display !== 'none') {
            btn.click();
            return true;
          }
        }
        // fallback：向右键盘
        return false;
      });

      if (!moved) {
        // 用键盘右箭头
        await page.keyboard.press('ArrowRight');
      }

      await page.waitForTimeout(800);
    }

    // 额外等待网络响应收集完毕
    await page.waitForTimeout(1_500);

    // ── 6. 同时从 DOM 补充提取（覆盖未触发响应的图）────────────────────────
    const domUrls = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img'));
      return imgs
        .map(img => img.src || img.getAttribute('data-src') || '')
        .filter(src =>
          (src.includes('xhscdn.com') || src.includes('sns-img') || src.includes('ci.xiaohongshu.com'))
          && !src.includes('avatar')
          && !src.includes('profile')
          && src.length > 40
        );
    });

    // ── 7. 视频提取（可选）────────────────────────────────────────────────────
    const videoUrls = await page.evaluate(() => {
      const videos = Array.from(document.querySelectorAll('video source, video'));
      return videos
        .map(v => (v as HTMLVideoElement).src || (v as HTMLSourceElement).src || v.getAttribute('src') || '')
        .filter(src => src.length > 40 && (src.includes('http')));
    }).catch(() => [] as string[]);

    // ── 8. 合并去重候选 URL ────────────────────────────────────────────────────
    // 优先用网络拦截到的高清图（有 Buffer），DOM URL 补充
    const candidateUrls = new Set<string>([
      ...capturedBuffers.keys(),
      ...domUrls.map(toOriginalUrl),
    ]);

    log.push(`📸 合计候选图片 URL：${candidateUrls.size} 个`);
    ctx.emit?.('log', `📸 发现 ${candidateUrls.size} 张候选图片，开始下载上传...`);

    if (candidateUrls.size === 0) {
      throw new Error('未找到小红书 CDN 图片。请确认帖子详情页已打开，或提供正确的 noteUrl');
    }

    // ── 9. 下载并上传 OSS ────────────────────────────────────────────────────
    const ossUrls: string[] = [];
    let idx = 0;

    for (const url of candidateUrls) {
      if (ossUrls.length >= maxImages) break;
      idx++;

      ctx.emit?.('log', `⬇️ 下载第 ${idx}/${Math.min(candidateUrls.size, maxImages)} 张...`);

      try {
        // 优先用已拦截的 Buffer，否则重新下载
        let buffer = capturedBuffers.get(url);
        if (!buffer) {
          const resp = await page.request.get(toOriginalUrl(url), {
            headers: { Referer: 'https://www.xiaohongshu.com/' },
            timeout: 15_000,
          });
          if (!resp.ok()) {
            log.push(`⚠️ 第 ${idx} 张下载失败 (HTTP ${resp.status()})，跳过`);
            continue;
          }
          buffer = await resp.body();
        }

        if (buffer.length < 5_000) {
          log.push(`⚠️ 第 ${idx} 张文件过小 (${buffer.length} B)，跳过`);
          continue;
        }

        const ext = url.includes('.png') ? 'png' : (url.includes('.webp') ? 'webp' : 'jpg');
        const ossPath = `${ossPrefix}/${batchId}_${String(idx).padStart(2, '0')}.${ext}`;
        const ossUrl = await uploadBuffer(buffer, ossPath, `image/${ext}`);
        ossUrls.push(ossUrl);

        log.push(`✅ 第 ${idx} 张：${(buffer.length / 1024).toFixed(1)} KB → ${ossUrl}`);
        ctx.emit?.('log', `✅ 第 ${idx} 张上传成功`);
      } catch (e) {
        log.push(`⚠️ 第 ${idx} 张失败：${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // 视频处理（如果有）
    const videoOssUrls: string[] = [];
    for (const vUrl of videoUrls.slice(0, 1)) {
      try {
        ctx.emit?.('log', `🎬 下载视频...`);
        const resp = await page.request.get(vUrl, {
          headers: { Referer: 'https://www.xiaohongshu.com/' },
          timeout: 60_000,
        });
        if (resp.ok()) {
          const buf = await resp.body();
          const ossPath = `${ossPrefix}/${batchId}_video.mp4`;
          const ossUrl = await uploadBuffer(buf, ossPath, 'video/mp4');
          videoOssUrls.push(ossUrl);
          log.push(`✅ 视频上传成功：${ossUrl}`);
        }
      } catch (e) {
        log.push(`⚠️ 视频下载失败：${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (ossUrls.length === 0) {
      throw new Error('所有图片下载均失败，请检查网络或登录状态');
    }

    log.push(`🎉 完成！下载 ${ossUrls.length} 张图片${videoOssUrls.length ? ` + ${videoOssUrls.length} 个视频` : ''}`);
    ctx.emit?.('log', `🎉 完成！共下载 ${ossUrls.length} 张图片`);

    if (ctx.vars) {
      ctx.vars[outputVar] = ossUrls.join(',');
    }

    const screenshot = await captureScreenshot(page);
    return {
      success: true,
      log,
      screenshot,
      output: {
        [outputVar]: ossUrls,
        xhsImages: ossUrls,
        xhsVideos: videoOssUrls,
        count: ossUrls.length,
        firstImage: ossUrls[0] ?? null,
      },
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    log.push(`❌ 下载失败：${error}`);
    const screenshot = await captureScreenshot(page).catch(() => undefined);
    return { success: false, log, error, screenshot };
  } finally {
    page.off('response', onResponse);
  }
}
