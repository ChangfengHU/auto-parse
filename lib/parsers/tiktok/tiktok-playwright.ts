import { chromium } from 'playwright';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

export async function parseTikTokWithPlaywright(videoUrl: string): Promise<{
  videoUrl: string;
  title: string;
  watermark: boolean;
}> {
  const browser = await chromium.launch({ 
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
    ]
  });
  
  try {
    const context = await browser.newContext({
      userAgent: USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
      locale: 'en-US',
      timezoneId: 'America/New_York',
    });

    const page = await context.newPage();
    
    let foundVideoUrl = '';
    let foundTitle = '';

    const result = await new Promise<{ videoUrl: string; title: string; watermark: boolean }>(
      async (resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('TikTok解析超时（90s）')), 90000);

        // 监听所有网络请求
        page.on('response', async resp => {
          const url = resp.url();
          
          // 捕获TikTok API响应
          if (url.includes('/api/item/detail/') || 
              url.includes('node/share/video/') ||
              url.includes('api/v1/node/share/video/')) {
            try {
              const json = await resp.json();
              console.log('[TikTok] API响应:', url);
              
              // TikTok数据结构解析
              const itemInfo = json?.itemInfo?.itemStruct || 
                              json?.aweme_details?.[0] || 
                              json?.itemList?.[0] ||
                              json?.video_data;
              
              if (itemInfo) {
                foundTitle = itemInfo.desc || itemInfo.title || '';
                
                const video = itemInfo.video;
                if (video) {
                  // 尝试多种可能的视频URL字段
                  foundVideoUrl = 
                    video.playApi || 
                    video.downloadAddr || 
                    video.playAddr ||
                    video.bitrateInfo?.[0]?.PlayAddr?.UrlList?.[0] ||
                    video.playAddrH264?.UrlList?.[0] ||
                    video.playAddr?.UrlList?.[0];

                  if (foundVideoUrl) {
                    clearTimeout(timer);
                    console.log('[TikTok] 找到视频URL:', foundVideoUrl);
                    resolve({ 
                      videoUrl: foundVideoUrl, 
                      title: foundTitle, 
                      watermark: false // TikTok API获取的通常是无水印的
                    });
                    return;
                  }
                }
              }
            } catch (e) {
              console.log('[TikTok] API解析失败:', e instanceof Error ? e.message : e);
            }
          }
          
          // 直接捕获.mp4视频文件
          if (url.includes('.mp4') && !url.includes('thumbnail')) {
            console.log('[TikTok] 捕获到MP4文件:', url);
            foundVideoUrl = url;
            
            if (foundTitle || foundVideoUrl) {
              clearTimeout(timer);
              resolve({ 
                videoUrl: foundVideoUrl, 
                title: foundTitle || 'TikTok Video', 
                watermark: url.includes('watermark') || url.includes('wm')
              });
            }
          }
        });

        try {
          console.log('[TikTok] 访问页面:', videoUrl);
          await page.goto(videoUrl, {
            waitUntil: 'load',
            timeout: 60000,
          });

          // 等待页面内容加载
          await page.waitForTimeout(3000);

          // 尝试获取页面标题作为视频标题
          try {
            foundTitle = await page.title();
            foundTitle = foundTitle.replace(' | TikTok', '').trim();
            console.log('[TikTok] 页面标题:', foundTitle);
          } catch (e) {
            console.log('[TikTok] 获取标题失败');
          }

          // 等待视频元素出现
          try {
            await page.waitForSelector('video', { timeout: 20000 });
            console.log('[TikTok] 找到video元素');
            
            // 尝试获取video的src属性
            const videoSrc = await page.evaluate(() => {
              const video = document.querySelector('video');
              return video ? video.src : null;
            });
            
            if (videoSrc && videoSrc.includes('.mp4')) {
              console.log('[TikTok] 从video元素获取到URL:', videoSrc);
              foundVideoUrl = videoSrc;
            }
          } catch (e) {
            console.log('[TikTok] video元素未找到');
          }

          // 如果有找到视频URL，返回结果
          if (foundVideoUrl) {
            clearTimeout(timer);
            resolve({ 
              videoUrl: foundVideoUrl, 
              title: foundTitle || 'TikTok Video', 
              watermark: false 
            });
            return;
          }

          // 继续等待网络请求
          await page.waitForTimeout(10000);
          
        } catch (e) {
          console.error('[TikTok] 页面访问失败:', e instanceof Error ? e.message : e);
        }

        clearTimeout(timer);
        reject(new Error(`TikTok解析失败: 未能获取到视频下载地址。标题: ${foundTitle}`));
      }
    );

    return result;
  } finally {
    await browser.close();
  }
}