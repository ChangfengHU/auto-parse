export interface ParseOptions {
  /** 是否包含水印 (仅对抖音生效) */
  watermark?: boolean;
  /** 视频质量 */
  quality?: string;
  /** 请求超时时间(毫秒) */
  timeout?: number;
}

export interface ParseResult {
  /** 平台标识 */
  platform: string;
  /** 视频ID */
  videoId: string;
  /** 视频URL */
  videoUrl: string;
  /** 视频标题 */
  title?: string;
  /** 是否有水印 */
  watermark: boolean;
  /** 本地文件路径 (用于ffmpeg合并等场景) */
  localFile?: string;
}