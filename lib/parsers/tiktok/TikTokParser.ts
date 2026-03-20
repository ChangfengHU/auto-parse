import { IVideoParser } from '../../interfaces/IVideoParser';
import { ParseOptions, ParseResult } from '../../types/ParseResult';
import { parseTikTokWithPlaywright } from './tiktok-playwright';

/**
 * TikTok视频解析器
 * 支持解析TikTok视频并获取无水印下载地址
 */
export class TikTokParser implements IVideoParser {
  readonly platform = 'tiktok';

  /**
   * 检查URL是否为TikTok链接
   */
  canHandle(url: string): boolean {
    return url.includes('tiktok.com') || url.includes('vm.tiktok.com');
  }

  /**
   * 解析TikTok视频
   */
  async parse(input: string, options: ParseOptions = {}): Promise<ParseResult> {
    // 从文本中提取TikTok链接
    const urlMatch = input.match(/https?:\/\/(?:www\.)?(?:vm\.)?tiktok\.com\/[^\s]*/);
    if (!urlMatch) {
      throw new Error('未找到有效的TikTok分享链接');
    }
    
    let targetUrl = urlMatch[0];
    
    // 处理短链接 vm.tiktok.com
    if (targetUrl.includes('vm.tiktok.com')) {
      targetUrl = await this.resolveShortUrl(targetUrl);
    }

    // 提取视频ID
    const videoIdMatch = targetUrl.match(/\/video\/(\d+)/);
    if (!videoIdMatch) {
      throw new Error('无法从TikTok链接中提取视频ID');
    }
    const videoId = videoIdMatch[1];

    try {
      // 使用Playwright解析
      const { videoUrl, title, watermark } = await parseTikTokWithPlaywright(targetUrl);
      
      return {
        platform: this.platform,
        videoId,
        videoUrl,
        title,
        watermark,
      };
    } catch (error) {
      throw new Error(`TikTok解析失败: ${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * 解析TikTok短链接
   */
  private async resolveShortUrl(shortUrl: string): Promise<string> {
    const { default: axios } = await import('axios');
    
    try {
      const response = await axios.get(shortUrl, {
        maxRedirects: 0,
        validateStatus: (status) => status >= 200 && status < 400,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        timeout: 10000,
      });
      
      const location = response.headers['location'];
      if (!location) {
        throw new Error('TikTok短链接解析失败');
      }
      
      return location;
    } catch (error) {
      if (error instanceof Error && 'response' in error && error.response) {
        const location = (error.response as any).headers['location'];
        if (location) return location;
      }
      throw new Error(`TikTok短链接解析失败: ${error instanceof Error ? error.message : error}`);
    }
  }
}