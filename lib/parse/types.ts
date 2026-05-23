export type ParseUploadProvider = 'oss' | 'supabase' | 'r2';

export type ParseAuthMode = 'platform' | 'custom';
export type ParseAuthType = 'cookie' | 'credential';

export interface ParseR2Config {
  uploadUrl: string;
  token: string;
  domain: string;
  path: string;
}

export interface ParseExportConfig {
  provider: ParseUploadProvider;
  r2: ParseR2Config;
}

export interface ParseAuthConfig {
  mode: ParseAuthMode;
  type: ParseAuthType;
  cookieStr: string;
  clientId: string;
}

export interface ParseRequestOptions {
  watermark?: boolean;
  export?: Partial<ParseExportConfig> & { r2?: Partial<ParseR2Config> };
  auth?: Partial<ParseAuthConfig>;
}

export const DEFAULT_R2_CONFIG: ParseR2Config = {
  uploadUrl: 'https://upload-r2.vyibc.com',
  token: 'yt-research-token-2026',
  domain: 'https://skill.vyibc.com',
  path: 'douyin',
};

export const DEFAULT_PARSE_EXPORT_CONFIG: ParseExportConfig = {
  provider: 'supabase',
  r2: { ...DEFAULT_R2_CONFIG },
};

export const DEFAULT_PARSE_AUTH_CONFIG: ParseAuthConfig = {
  mode: 'platform',
  type: 'cookie',
  cookieStr: '',
  clientId: '',
};

export const PARSE_EXPORT_CONFIG_KEY = 'doouyin-parse-export-config';
export const PARSE_AUTH_CONFIG_KEY = 'doouyin-parse-auth-config';
