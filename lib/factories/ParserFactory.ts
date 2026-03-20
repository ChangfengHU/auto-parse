import { IVideoParser } from '../interfaces/IVideoParser';
import { TikTokParser } from '../parsers/tiktok/TikTokParser';

/**
 * 解析器工厂
 * 使用工厂模式管理不同平台的解析器
 */
export class ParserFactory {
  private static parsers: IVideoParser[] = [];
  
  static {
    // 注册所有解析器
    this.registerParser(new TikTokParser());
  }

  /**
   * 注册解析器
   */
  static registerParser(parser: IVideoParser): void {
    this.parsers.push(parser);
  }

  /**
   * 根据URL获取对应的解析器
   */
  static getParser(url: string): IVideoParser {
    const parser = this.parsers.find(p => p.canHandle(url));
    if (!parser) {
      throw new Error('暂不支持该平台，目前支持：TikTok');
    }
    return parser;
  }

  /**
   * 获取所有支持的平台
   */
  static getSupportedPlatforms(): string[] {
    return this.parsers.map(p => p.platform);
  }
}