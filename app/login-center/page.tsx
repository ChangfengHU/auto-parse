'use client';

import { useRef, useState } from 'react';

// 登录中心:在网页上直接扫服务器浏览器里的登录二维码。
// 覆盖 视频号取流(元宝) 与 小程序发布(公众平台) 两个登录目标。
const TARGETS = [
  { key: 'yuanbao', label: '腾讯元宝', hint: '视频号解析取视频流依赖此登录' },
  { key: 'mp', label: '微信公众平台', hint: '小程序发布自动化依赖此登录(管理员扫)' },
];

export default function LoginCenterPage() {
  const [target, setTarget] = useState('');
  const [qr, setQr] = useState('');
  const [logs, setLogs] = useState<string[]>([]);
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const esRef = useRef<EventSource | null>(null);

  const start = (key: string) => {
    esRef.current?.close();
    setTarget(key);
    setQr('');
    setLogs([]);
    setState('running');
    const es = new EventSource(`/api/login/console?target=${key}`);
    esRef.current = es;
    es.onmessage = (ev) => {
      try {
        const { type, payload } = JSON.parse(ev.data);
        if (type === 'qrcode' || type === 'refresh') setQr(payload);
        if (type === 'log') setLogs((l) => [...l, payload]);
        if (type === 'done') {
          const d = JSON.parse(payload);
          setLogs((l) => [...l, `✅ ${d.message}`]);
          setState('done');
          es.close();
        }
        if (type === 'error') {
          setLogs((l) => [...l, `❌ ${payload}`]);
          setState('error');
          es.close();
        }
      } catch { /* ignore malformed */ }
    };
    es.onerror = () => {
      setLogs((l) => [...l, '❌ 连接中断(可能上一会话未结束或网络波动),3 秒后可重点按钮重试']);
      setState((s) => (s === 'running' ? 'error' : s));
      es.close();
    };
  };

  return (
    <main style={{ maxWidth: 560, margin: '40px auto', padding: '0 16px', fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>服务登录中心</h1>
      <p style={{ color: '#667', fontSize: 13, marginBottom: 20 }}>
        二维码来自服务器上的常驻浏览器;扫码后登录态保存在服务器,无需 VNC。
      </p>
      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        {TARGETS.map((t) => (
          <button
            key={t.key}
            onClick={() => start(t.key)}
            disabled={state === 'running' && target === t.key}
            style={{
              flex: 1, padding: '14px 10px', borderRadius: 10, cursor: 'pointer',
              border: target === t.key ? '2px solid #176b56' : '1px solid #ccd',
              background: target === t.key ? '#e7f1ed' : '#fff',
            }}
          >
            <div style={{ fontWeight: 700 }}>{t.label}</div>
            <div style={{ fontSize: 12, color: '#667', marginTop: 4 }}>{t.hint}</div>
          </button>
        ))}
      </div>
      {qr && state !== 'done' && (
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="登录二维码" style={{ width: 260, border: '1px solid #dde', borderRadius: 8 }} />
        </div>
      )}
      {state === 'done' && (
        <div style={{ textAlign: 'center', fontSize: 40, marginBottom: 16 }}>✅</div>
      )}
      <div style={{ background: '#f6f8f7', borderRadius: 8, padding: 12, fontSize: 13, color: '#445' }}>
        {logs.length === 0 ? '选择上方目标开始登录。' : logs.map((l, i) => <div key={i}>{l}</div>)}
      </div>
    </main>
  );
}
