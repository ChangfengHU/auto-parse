'use client';

import { useEffect, useRef, useState } from 'react';
type Snapshot = {
  sessionId: string; status: string; sessionRevision: number; currentStep: number; totalSteps: number;
  vars?: Record<string,string>; browserInstance?: number;
  history?: Array<{stepIndex: number; label?: string; result: {success: boolean; stepSkipped?: boolean; error?: string; output?: Record<string, unknown>}}>;
};

/** The workbench uses the authenticated MCP runtime, not a second execution engine. */
export function WorkflowManagedRun({ workflowId, vars, dirty, disabled }: {
  workflowId: string; vars: Record<string,string>; dirty: boolean; disabled: boolean;
}) {
  const [token,setToken] = useState('');
  const [browser,setBrowser] = useState(1);
  const [directPublish,setDirectPublish] = useState(false);
  const [snapshot,setSnapshot] = useState<Snapshot | null>(null);
  const [sessionId,setSessionId] = useState('');
  const [shot,setShot] = useState('');
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const mounted = useRef(true);
  const pollGeneration = useRef(0);
  const storageKey = 'workflow-managed-session:' + workflowId;
  useEffect(() => {
    mounted.current = true;
    try { setSessionId(sessionStorage.getItem(storageKey) || ''); } catch { /* storage is optional */ }
    return () => { mounted.current = false; };
  }, [storageKey]);
  async function call(name: string, args: Record<string,unknown>) {
    const r = await fetch('/api/workflows/mcp',{method:'POST',headers:{
      Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json, text/event-stream',
    },body:JSON.stringify({jsonrpc:'2.0',id:crypto.randomUUID(),method:'tools/call',params:{name,arguments:args}}),signal:AbortSignal.timeout(45000)});
    if (!r.ok) throw new Error(r.status === 401 ? '请使用 Vault 中已有的工作流 MCP 凭据授权。' : '工作流接口错误：' + r.status);
    const payload = await r.json();
    const content = payload.result?.content || [];
    const data = JSON.parse(content.find((c: {type:string}) => c.type === 'text')?.text || '{}');
    if (payload.error || payload.result?.isError) throw new Error(data.error || payload.error?.message || '执行失败');
    const img = content.find((c: {type:string}) => c.type === 'image');
    if (img && mounted.current) setShot('data:'+img.mimeType+';base64,'+img.data);
    return data;
  }
  async function poll(id: string) {
    const generation = ++pollGeneration.current;
    do {
      let data: Snapshot;
      try { data = await call('workflow_get_session',{sessionId:id}); }
      catch (e) { if (generation !== pollGeneration.current) return; throw e; }
      if (!mounted.current || generation !== pollGeneration.current) return;
      setSnapshot(data);
      setDirectPublish(data.vars?.directPublish === 'true');
      if (data.browserInstance === 1 || data.browserInstance === 2) setBrowser(data.browserInstance);
      if (data.status !== 'running') return;
      await new Promise(resolve => setTimeout(resolve,2000));
    } while (mounted.current && generation === pollGeneration.current);
  }
  async function run() {
    if (busy || sessionId || disabled || dirty) return;
    setBusy(true); setError(''); setSnapshot(null); setShot('');
    try {
      const input = {...vars,directPublish:String(directPublish),requestId:vars.requestId || crypto.randomUUID()};
      const opened: Snapshot = await call('workflow_open_session',{workflowId,browserInstance:browser,vars:input,confirmBrowserControl:true});
      setSessionId(opened.sessionId); setSnapshot(opened);
      try { sessionStorage.setItem(storageKey,opened.sessionId); } catch { /* no credentials persisted */ }
      await call('workflow_run',{sessionId:opened.sessionId,expectedRevision:opened.sessionRevision,requestId:input.requestId,confirmExecution:true});
      await poll(opened.sessionId);
    } catch (e) { setError((e as Error).message + '。结果不明时只刷新核对，不自动重跑。'); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function refresh() {
    setBusy(true); setError('');
    try { await poll(sessionId); } catch(e) { setError((e as Error).message); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function close() {
    pollGeneration.current++;
    setBusy(true); setError('');
    try {
      const result = await call('workflow_close_session',{sessionId});
      if (result.status !== 'closed') throw new Error('正在停止，请稍后核对；不会撤销已提交内容');
      setSessionId(''); try { sessionStorage.removeItem(storageKey); } catch { /* optional */ }
    } catch(e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const receipt = snapshot?.history?.map(h => h.result.output).find(o => o?.published === true);
  return <details className="rounded-lg border border-primary/30 p-2 text-xs" open>
    <summary className="font-semibold">已登录浏览器 · 一键完整执行</summary>
    <div className="mt-2 space-y-2">
      <p className="text-muted-foreground">执行已保存的正式工作流；新增/修改节点后先保存。使用 MCP 授权，凭据仅留当前页面内存。</p>
      <label className="block">工作流 MCP 凭据
        <input aria-label="工作流 MCP 凭据" type="password" autoComplete="off" value={token} onChange={e=>setToken(e.target.value)} className="mt-1 w-full rounded border bg-background px-2 py-1"/>
      </label>
      <label className="block">84 浏览器
        <select aria-label="84 浏览器" value={browser} onChange={e=>setBrowser(Number(e.target.value))} disabled={busy || !!sessionId} className="ml-2 rounded border bg-background">
          <option value={1}>1 号</option><option value={2}>2 号</option>
        </select>
      </label>
      <label className="flex gap-2"><input type="checkbox" checked={directPublish} onChange={e=>setDirectPublish(e.target.checked)} disabled={busy || !!sessionId}/>直接发布（directPublish=true）</label>
      <p>{directPublish ? '将执行发布节点，产生真实公开提交；审核结果另行回查。' : '默认 false：跳过发布节点。按工作流配置保存草稿或停留在准备完成页；准备完成不等于草稿已保存。'}</p>
      <p className="text-muted-foreground">此开关仅控制配置了 directPublish 条件的节点；其他节点照常执行。</p>
      {!sessionId ? <button type="button" onClick={()=>void run()} disabled={!token || busy || dirty || disabled} className="w-full rounded bg-primary py-2 text-white disabled:opacity-40">一键执行完整流程</button> :
        <div className="flex gap-2"><button type="button" onClick={()=>void refresh()} disabled={!token || busy}>刷新同一任务</button><button type="button" onClick={()=>void close()} disabled={!token}>停止/关闭任务页</button></div>}
      {dirty ? <p>请先保存节点修改。</p> : null}
      <div aria-live="polite">{busy ? '执行/核对中…' : snapshot ? snapshot.status : ''}</div>
      {error ? <p role="alert" className="text-red-400 break-words">{error}</p> : null}
      {snapshot?.history ? <ol className="space-y-1">{snapshot.history.map((h,i)=><li key={i}>{h.stepIndex+1}. {h.label}：{h.result.stepSkipped ? '按条件跳过' : h.result.success ? '成功' : '失败：'+h.result.error}</li>)}</ol> : null}
      {receipt ? <p className="break-all">已取得作品回执：{String(receipt.postId ?? receipt.noteId ?? receipt.awemeId)}（{String(receipt.moderation)}）</p> : null}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {shot ? <img src={shot} alt="当前任务浏览器截图" className="w-full rounded border"/> : null}
      <p className="text-muted-foreground">会话不跨服务重启保存；已有发布意图/回执会保留。未知结果不得更换请求重试。</p>
    </div>
  </details>;
}
