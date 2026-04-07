/**
 * 独立测试脚本 - 测试 Meta AI 下载功能
 * 运行: npx ts-node scripts/test-metaai-download.ts
 */
import { chromium } from 'playwright';

const ADS_API = 'http://local.adspower.net:50325';
const PROFILE_ID = 'kobgpj5';

async function main() {
  console.log('🚀 启动测试...');
  
  // 1. 连接 AdsPower
  const res = await fetch(`${ADS_API}/api/v1/browser/start?user_id=${PROFILE_ID}`);
  const data = await res.json();
  
  if (data.code !== 0) {
    throw new Error(`AdsPower 启动失败: ${data.msg}`);
  }
  
  const wsUrl = data.data.ws.puppeteer;
  console.log(`✅ AdsPower 已连接: ${wsUrl}`);
  
  // 2. 连接 Playwright
  const browser = await chromium.connectOverCDP(wsUrl);
  const contexts = browser.contexts();
  const context = contexts[0] || await browser.newContext();
  const pages = context.pages();
  const page = pages[0] || await context.newPage();
  
  console.log(`📍 当前页面: ${page.url()}`);
  
  // 3. 测试图片悬停
  console.log('\n--- 测试 1: 图片悬停 ---');
  const images = await page.$$('img');
  console.log(`🖼️ 找到 ${images.length} 个图片`);
  
  let hoveredCount = 0;
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    try {
      const box = await img.boundingBox();
      console.log(`  img[${i}] box:`, box ? `${box.width}x${box.height}` : 'null');
      if (box && box.width > 80 && box.height > 80) {
        await img.hover({ timeout: 2000 });
        await page.waitForTimeout(150);
        hoveredCount++;
        console.log(`  ✅ 悬停成功`);
      }
    } catch (e) {
      console.log(`  ❌ 悬停失败: ${e}`);
    }
  }
  console.log(`👆 悬停了 ${hoveredCount} 个大图`);
  
  // 4. 测试下载按钮查找
  console.log('\n--- 测试 2: 查找下载按钮 ---');
  
  // 方法 A: aria-label
  const btnA = await page.$$('[aria-label="Download"]');
  console.log(`[aria-label="Download"]: ${btnA.length} 个`);
  
  // 方法 B: 文本
  const btnB = await page.$$('button:has-text("Download")');
  console.log(`button:has-text("Download"): ${btnB.length} 个`);
  
  // 方法 C: SVG 下载图标
  const btnC = await page.$$('button svg[data-icon="download"]');
  console.log(`button svg[data-icon="download"]: ${btnC.length} 个`);
  
  // 方法 D: 打印所有按钮
  console.log('\n--- 所有按钮列表 ---');
  const allBtns = await page.$$('button');
  console.log(`总共 ${allBtns.length} 个按钮`);
  
  for (let i = 0; i < Math.min(allBtns.length, 15); i++) {
    try {
      const btn = allBtns[i];
      const ariaLabel = await btn.getAttribute('aria-label');
      const text = await btn.textContent();
      const box = await btn.boundingBox();
      console.log(`  [${i}] aria="${ariaLabel}", text="${text?.slice(0,20)}", box=${box ? `${Math.round(box.x)},${Math.round(box.y)}` : 'null'}`);
    } catch { /* skip */ }
  }
  
  // 5. 尝试用 evaluate 在页面上找
  console.log('\n--- 测试 3: 页面内 JS 查找 ---');
  const pageButtons = await page.evaluate(() => {
    const results: any[] = [];
    document.querySelectorAll('button').forEach((btn, i) => {
      const rect = btn.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        results.push({
          index: i,
          ariaLabel: btn.getAttribute('aria-label'),
          textContent: btn.textContent?.slice(0, 30),
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          w: Math.round(rect.width),
          h: Math.round(rect.height)
        });
      }
    });
    return results;
  });
  
  console.log(`页面内找到 ${pageButtons.length} 个可见按钮:`);
  pageButtons.slice(0, 15).forEach(b => {
    console.log(`  [${b.index}] "${b.ariaLabel}" @ (${b.x},${b.y}) ${b.w}x${b.h}`);
  });
  
  // 找到 Download 按钮
  const downloadBtns = pageButtons.filter(b => b.ariaLabel === 'Download');
  console.log(`\n🎯 Download 按钮: ${downloadBtns.length} 个`);
  downloadBtns.forEach(b => {
    console.log(`  @ (${b.x}, ${b.y})`);
  });
  
  console.log('\n✅ 测试完成');
  await browser.close();
}

main().catch(console.error);
