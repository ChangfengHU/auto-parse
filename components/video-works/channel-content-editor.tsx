'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import Image from 'next/image';
import {channelName,type ChannelCopy,type WorkView} from '@/lib/video-works/presentation';
type Plan={revision:number;content:ChannelCopy;source:string;sourceAccountId?:string;updatedAt?:string;canEdit:boolean;lastRequestId?:string;history:Array<ChannelCopy&{revision:number;updatedAt:string}>};
const reasons:Record<string,string>={saved_channel_content:'已保存的渠道方案',channel_default:'继承此渠道默认方案',delivery_snapshot:'来自最近一次提交的文案',work_default:'继承作品默认文案'};
const err=(s:string)=>s==='channel_content_revision_conflict'?'此渠道内容已被其他人或 Agent 更新，请重新读取后再保存。':s==='channel_cover_invalid'?'封面请使用 resource.vyibc.com 或 cdn.vyibc.com 的 HTTPS 地址。':s==='channel_editor_signin_required'?'当前只读，请使用含内容编辑权限的操作入口。':s==='channel_request_conflict'?'请求内容发生变化，请重新读取保存结果。':s==='channel_content_invalid'?'请填写标题，正文不超过20000字，标签最多20个。':s;
export default function ChannelContentEditor({work,platform,accountId,onChanged,onDirty}:{work:WorkView;platform:string;accountId:string;onChanged:()=>Promise<void>;onDirty:(value:boolean)=>void}){
 const [plan,setPlan]=useState<Plan|null>(null),[form,setForm]=useState<ChannelCopy>({title:'',description:'',topics:[]}),[tags,setTags]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[unknown,setUnknown]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const planRef=useRef<Plan|null>(null);useEffect(()=>{planRef.current=plan},[plan]);
 const original=useRef(''),request=useRef(''),intent=useRef<ChannelCopy|null>(null),seq=useRef(0),pending=useRef<AbortController|null>(null);
 const normalized={...form,topics:tags.split(/[\s,，]+/u).filter(Boolean)};
 const dirty=!!plan&&JSON.stringify(normalized)!==original.current;
 useEffect(()=>{onDirty(dirty)},[dirty,onDirty]);
 const load=useCallback(async(reconcile=false)=>{
  const n=++seq.current;pending.current?.abort();const abort=new AbortController();pending.current=abort;setLoading(true);setError('');
  try{const p=new URLSearchParams({platform,...accountId?{accountId}:{}});const r=await fetch('/api/video-works/'+work.id+'/channel-content?'+p,{cache:'no-store',signal:abort.signal}),d=await r.json();if(n!==seq.current)return;if(!r.ok)throw Error(d.error||'读取失败');
   if(reconcile&&request.current&&d.lastRequestId!==request.current){
    setPlan(d);setUnknown(false);setMessage('当前尚未保存这次修改；你的输入已保留。');
    if(d.revision!==planRef.current?.revision){setError('渠道方案已有新版本。你的输入已保留，可核对当前历史后再保存。');request.current='';intent.current=null}
    return;
   }
   if(reconcile)setMessage('已核实：渠道方案已保存。');
   setPlan(d);setForm(d.content);setTags(d.content.topics.join(' '));original.current=JSON.stringify(d.content);setUnknown(false);request.current='';intent.current=null;
  }catch(e){if(n===seq.current&&!abort.signal.aborted)setError(err(e instanceof Error?e.message:'读取失败'))}finally{if(n===seq.current&&!abort.signal.aborted)setLoading(false)}
 },[work.id,platform,accountId]);
 useEffect(()=>{void load();return()=>{pending.current?.abort()}},[load]);
 async function save(){
  if(!plan||!plan.canEdit||busy||unknown)return;setBusy(true);setError('');setMessage('');
  if(!request.current){request.current='content-'+crypto.randomUUID();intent.current=normalized}
  try{const r=await fetch('/api/video-works/'+work.id+'/channel-content',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...intent.current,platform,...accountId?{accountId}:{},requestId:request.current,expectedRevision:plan.revision,confirmSave:true})}),d=await r.json();
   if(!r.ok){if(r.status>=500)setUnknown(true);else{request.current='';intent.current=null}throw Error(d.error||'保存失败')}
   request.current='';intent.current=null;setMessage('已保存渠道方案 v'+d.content.revision+'，没有发布到平台。');await load();await onChanged();
  }catch(e){setError(err(e instanceof Error?e.message:'保存结果待核实'));if(request.current&&intent.current)setUnknown(true)}finally{setBusy(false)}
 }
 async function copy(text:string){try{await navigator.clipboard.writeText(text);setMessage('已复制')}catch{setError('复制被浏览器限制，请直接选择文本复制。')}}
 const field=(k:keyof ChannelCopy,v:string)=>setForm(old=>({...old,[k]:v}));
 if(loading)return <section aria-busy="true" className="vw-editor"><p className="vw-muted">正在读取此渠道的标题、正文和封面…</p></section>;
 if(!plan)return <section className="vw-editor"><p role="alert" className="vw-error">{error}</p><button className="vw-btn" onClick={()=>void load()}>重新读取</button></section>;
 const locked=busy||unknown||!plan.canEdit,cover=form.cover||{};
 return <section className="vw-editor" aria-label={channelName(platform)+'渠道内容'}>
  <header className="vw-editor-heading"><div><h3>{channelName(platform)}的发布内容</h3><p className="vw-muted">{reasons[plan.source]||plan.source}{plan.revision?' · v'+plan.revision:''}{plan.sourceAccountId?' · 账号 '+plan.sourceAccountId:''}</p></div><span className={'vw-tag '+(dirty?'warning':'neutral')}>{dirty?'未保存':plan.revision?'已保存':'尚未单独保存'}</span></header>
  <p className="vw-note">这里只保存本作品的渠道方案。已提交过的标题、正文和封面保留在“分发记录”，不会被覆盖。</p>
  {!plan.canEdit&&<p className="vw-note">当前可查看和复制。编辑需使用包含“内容编辑”权限的操作入口。</p>}
  {error&&<p role="alert" className="vw-error">{error}</p>}{message&&<p role="status" className="vw-success">{message}</p>}
  <label className="vw-field"><span><strong>发布标题</strong><small>{Array.from(form.title).length} 字</small></span><input readOnly={locked} maxLength={500} value={form.title} onChange={e=>field('title',e.target.value)}/></label>
  <label className="vw-field"><span><strong>发布正文</strong><small>{Array.from(form.description).length} 字</small></span><textarea readOnly={locked} rows={7} maxLength={20000} value={form.description} onChange={e=>field('description',e.target.value)}/></label>
  <label className="vw-field"><span><strong>标签</strong><small>空格分隔，最多20个</small></span><input readOnly={locked} value={tags} onChange={e=>setTags(e.target.value)} placeholder="生活记录 原创故事"/></label>
  <div className="vw-cover-grid">{(['verticalUrl','horizontalUrl'] as const).map(k=><label className="vw-field" key={k}><span><strong>{k==='verticalUrl'?'竖版封面':'横版封面'}</strong><small>可选</small></span><input readOnly={locked} value={cover[k]||''} placeholder="https://resource.vyibc.com/…" onChange={e=>setForm(old=>({...old,cover:{...old.cover,[k]:e.target.value}}))}/>{cover[k]&&/^https:\/\/(cdn|resource)\.vyibc\.com\/[^?#]+$/.test(cover[k]!)&&<a href={cover[k]} target="_blank" rel="noreferrer" className="vw-cover-preview"><Image src={cover[k]!} unoptimized width={160} height={110} alt={k==='verticalUrl'?'竖版封面预览':'横版封面预览'}/></a>}</label>)}</div>
  <p className="vw-muted">不同平台可保存不同内容和封面。未接入的平台仅保存方案；公众号当前仍使用推荐帧封面。</p>
  <footer className="vw-editor-actions"><div className="vw-inline"><button className="vw-btn" onClick={()=>void copy(form.title)}>复制标题</button><button className="vw-btn" onClick={()=>void copy(form.description)}>复制正文</button><button className="vw-btn" onClick={()=>void copy([form.title,form.description,...normalized.topics.map(t=>'#'+t.replace(/^#/,''))].filter(Boolean).join('\n\n'))}>复制全部</button></div>{plan.canEdit&&<button className="vw-btn primary" disabled={busy||unknown||!dirty||!form.title.trim()||normalized.topics.length>20} onClick={()=>void save()}>{busy?'正在保存…':'保存渠道方案'}</button>}</footer>
  {unknown&&<div role="status" className="vw-note">保存结果待核实，内容已保留。请先重新读取，不要换请求重复保存。<button className="vw-link" onClick={()=>void load(true)}>重新读取保存结果</button></div>}
  {!!plan.history.length&&<details className="vw-history"><summary>渠道方案历史 · {plan.history.length} 个版本</summary>{[...plan.history].reverse().map(h=><article key={h.revision}><header><strong>v{h.revision}</strong><time>{new Date(h.updatedAt).toLocaleString('zh-CN')}</time></header><h4>{h.title}</h4><p>{h.description||'无正文'}</p><button className="vw-link" onClick={()=>void copy([h.title,h.description].join('\n\n'))}>复制此版本</button></article>)}</details>}
 </section>;
}
