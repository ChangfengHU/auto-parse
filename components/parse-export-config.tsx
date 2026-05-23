'use client';

import { useEffect, useState } from 'react';
import type { ParseAuthConfig, ParseExportConfig } from '@/lib/parse/types';
import {
  DEFAULT_PARSE_AUTH_CONFIG,
  DEFAULT_PARSE_EXPORT_CONFIG,
  PARSE_AUTH_CONFIG_KEY,
  PARSE_EXPORT_CONFIG_KEY,
} from '@/lib/parse/types';

type Props = {
  open: boolean;
  onClose: () => void;
  exportConfig: ParseExportConfig;
  authConfig: ParseAuthConfig;
  onSave: (exportConfig: ParseExportConfig, authConfig: ParseAuthConfig) => void;
};

export function loadParseExportConfig(): ParseExportConfig {
  if (typeof window === 'undefined') return DEFAULT_PARSE_EXPORT_CONFIG;
  try {
    const raw = localStorage.getItem(PARSE_EXPORT_CONFIG_KEY);
    if (!raw) return DEFAULT_PARSE_EXPORT_CONFIG;
    const parsed = JSON.parse(raw) as Partial<ParsedExportConfig>;
    return {
      provider: parsed.provider === 'oss' || parsed.provider === 'r2' || parsed.provider === 'supabase'
        ? parsed.provider
        : DEFAULT_PARSE_EXPORT_CONFIG.provider,
      r2: { ...DEFAULT_PARSE_EXPORT_CONFIG.r2, ...(parsed.r2 ?? {}) },
    };
  } catch {
    return DEFAULT_PARSE_EXPORT_CONFIG;
  }
}

type ParsedExportConfig = ParseExportConfig;

export function loadParseAuthConfig(): ParseAuthConfig {
  if (typeof window === 'undefined') return DEFAULT_PARSE_AUTH_CONFIG;
  try {
    const raw = localStorage.getItem(PARSE_AUTH_CONFIG_KEY);
    if (!raw) return DEFAULT_PARSE_AUTH_CONFIG;
    const parsed = JSON.parse(raw) as Partial<ParsedAuthConfig>;
    return {
      mode: parsed.mode === 'custom' ? 'custom' : 'platform',
      type: parsed.type === 'credential' ? 'credential' : 'cookie',
      cookieStr: parsed.cookieStr ?? '',
      clientId: parsed.clientId ?? '',
    };
  } catch {
    return DEFAULT_PARSE_AUTH_CONFIG;
  }
}

type ParsedAuthConfig = ParseAuthConfig;

export function ParseExportConfigModal({ open, onClose, exportConfig, authConfig, onSave }: Props) {
  const [draftExport, setDraftExport] = useState(exportConfig);
  const [draftAuth, setDraftAuth] = useState(authConfig);

  useEffect(() => {
    if (open) {
      setDraftExport(exportConfig);
      setDraftAuth(authConfig);
    }
  }, [open, exportConfig, authConfig]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-card border border-border rounded-2xl shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-card border-b border-border px-5 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-foreground">导出与登录配置</h2>
            <p className="text-xs text-muted-foreground mt-0.5">配置保存到浏览器本地，下次解析自动生效</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg leading-none">×</button>
        </div>

        <div className="p-5 space-y-6">
          <section className="space-y-3">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">导出目标</h3>
            <div className="grid grid-cols-3 gap-2">
              {([
                ['supabase', 'Supabase'],
                ['oss', '阿里云 OSS'],
                ['r2', 'Cloudflare R2'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setDraftExport((prev) => ({ ...prev, provider: value }))}
                  className={`py-2 px-2 rounded-lg text-xs font-medium border transition-colors ${
                    draftExport.provider === value
                      ? 'bg-primary text-white border-primary'
                      : 'bg-background border-border text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {draftExport.provider === 'r2' && (
              <div className="space-y-2 rounded-xl border border-border bg-muted/20 p-3">
                <label className="block text-xs text-muted-foreground">上传 API</label>
                <input
                  value={draftExport.r2.uploadUrl}
                  onChange={(e) => setDraftExport((p) => ({ ...p, r2: { ...p.r2, uploadUrl: e.target.value } }))}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs font-mono"
                  placeholder="https://upload-r2.vyibc.com"
                />
                <label className="block text-xs text-muted-foreground">Bearer Token</label>
                <input
                  value={draftExport.r2.token}
                  onChange={(e) => setDraftExport((p) => ({ ...p, r2: { ...p.r2, token: e.target.value } }))}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs font-mono"
                  placeholder="yt-research-token-2026"
                />
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">公网域名</label>
                    <input
                      value={draftExport.r2.domain}
                      onChange={(e) => setDraftExport((p) => ({ ...p, r2: { ...p.r2, domain: e.target.value } }))}
                      className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs font-mono"
                      placeholder="https://skill.vyibc.com"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">存储路径</label>
                    <input
                      value={draftExport.r2.path}
                      onChange={(e) => setDraftExport((p) => ({ ...p, r2: { ...p.r2, path: e.target.value } }))}
                      className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs font-mono"
                      placeholder="douyin"
                    />
                  </div>
                </div>
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">抖音登录（无水印解析）</h3>
            <div className="grid grid-cols-2 gap-2">
              {([
                ['platform', '平台登录'],
                ['custom', '指定登录'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setDraftAuth((prev) => ({ ...prev, mode: value }))}
                  className={`py-2 px-2 rounded-lg text-xs font-medium border transition-colors ${
                    draftAuth.mode === value
                      ? 'bg-primary text-white border-primary'
                      : 'bg-background border-border text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {draftAuth.mode === 'platform' ? (
              <p className="text-xs text-muted-foreground rounded-lg bg-muted/30 p-3">
                使用服务端已保存的登录信息（发布页扫码 / 插件同步 / .douyin-cookie.json / DOUYIN_COOKIE）
              </p>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  {([
                    ['cookie', '粘贴 Cookie'],
                    ['credential', '插件凭证'],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setDraftAuth((prev) => ({ ...prev, type: value }))}
                      className={`py-2 px-2 rounded-lg text-xs font-medium border transition-colors ${
                        draftAuth.type === value
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : 'bg-background border-border text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {draftAuth.type === 'cookie' ? (
                  <textarea
                    rows={4}
                    value={draftAuth.cookieStr}
                    onChange={(e) => setDraftAuth((p) => ({ ...p, cookieStr: e.target.value }))}
                    placeholder="sessionid=xxx; uid_tt=xxx; ..."
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs font-mono resize-none"
                  />
                ) : (
                  <input
                    value={draftAuth.clientId}
                    onChange={(e) => setDraftAuth((p) => ({ ...p, clientId: e.target.value }))}
                    placeholder="dy_xxxxxxxx"
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs font-mono"
                  />
                )}
              </div>
            )}
          </section>
        </div>

        <div className="sticky bottom-0 bg-card border-t border-border px-5 py-4 flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">取消</button>
          <button
            onClick={() => onSave(draftExport, draftAuth)}
            className="px-4 py-2 text-sm font-semibold bg-primary text-white rounded-lg hover:bg-primary/90"
          >
            保存配置
          </button>
        </div>
      </div>
    </div>
  );
}

export function saveParseConfigs(exportConfig: ParseExportConfig, authConfig: ParseAuthConfig) {
  localStorage.setItem(PARSE_EXPORT_CONFIG_KEY, JSON.stringify(exportConfig));
  localStorage.setItem(PARSE_AUTH_CONFIG_KEY, JSON.stringify(authConfig));
}

export function providerLabel(provider: ParseExportConfig['provider']) {
  if (provider === 'r2') return 'R2';
  if (provider === 'oss') return 'OSS';
  return 'Supabase';
}
