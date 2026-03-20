import { ParseOptions, ParseResult } from '../types/ParseResult';

/**
 * 视频解析器通用接口
 * 所有平台解析器都必须实现此接口
 */
export interface IVideoParser {
  /** 平台名称 */
  readonly platform: string;

  /** 
   * 检查是否能处理此URL
   * @param url 待检查的URL
   * @returns true表示能处理
   */
  canHandle(url: string): boolean;

  /**
   * 解析视频
   * @param url 视频分享链接或包含链接的文本
   * @param options 解析选项
   * @returns 解析结果
   */
  parse(url: string, options?: ParseOptions): Promise<ParseResult>;
}