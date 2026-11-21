'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import Image from 'next/image';
import {DOUYIN_VIDEO_OPTIONS} from '@/lib/workflow/douyin-video-fields';
import type {ChannelCopy} from '@/lib/video-works/presentation';
type Operation={state:string;taskId?:string;requestId?:string;receipt?:{awemeId?:string;videoUrl?:string;workId?:string;url?:string};error?:string};
type Plan={accountId:string;accounts:string[];content:ChannelCopy;aiGenerated:boolean;originalRetained:boolean;originalBytes:number|null};
const errors:Record<string,string>={publication_web_access_required:'当前入口没有抖音发布权限，请通过已连接的 Agent 开启发布操作。',publication_previous_result_unresolved:'这个账号还有一项发布结果待核实，请先查看原投递记录。',publication_account_not_previously_verified:'这个账号尚无已核验的发布记录，请先由 Agent 核对账号。',publication_ai_declaration_required:'作品记录标记为 AI 内容，需要保留平台 AI 声明。',publication_metadata_invalid:'请检查标题、正文和标签：标题最多30字，正文900字符，标签最多5个且不含标点或空格。',publication_cover_url_invalid:'封面需要自有资源域的 HTTPS JPG 或 PNG 地址，不带查询参数。',work_original_not_retained_poll_work_first:'原片仍待留存，请稍后刷新。',publication_original_exceeds_512mib:'原片超过512 MiB，未自动降低画质。'};
const text=(e:unknown)=>{const s=e instanceof Error?e.message:String(e);return errors[s]||s};
const pending=(s?:string)=>['running','reserved','paused'].includes(s||'');
const labels:Record<string,string>={published:'已取得抖音发布回执',prepared:'抖音发布页已准备',running:'工作流执行中',reserved:'请求已预留',paused:'任务等待处理',failed:'任务未完成',error:'任务失败',unknown:'结果待核实'};
export default function DouyinPublishPanel({workId,onChanged,onDirty,onBusy,onManage}:{workId:string;onChanged:()=>Promise<void>;onDirty:(v:boolean)=>void;onBusy:(v:boolean)=>void;onManage:()=>void}){
 const [plan,setPlan]=useState<Plan|null>(null),[form,setForm]=useState<ChannelCopy>({title:'',description:'',topics:[]}),[account,setAccount]=useState(''),[tags,setTags]=useState(''),[ai,setAi]=useState(false),[allowed,setAllowed]=useState(false),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[operation,setOperation]=useState<Operation|null>(null),[unknown,setUnknown]=useState(false),[review,setReview]=useState(false),[accepted,setAccepted]=useState(false),[error,setError]=useState('');
 const original=useRef(''),sequence=useRef(0),changed=useRef(onChanged),busyRef=useRef(onBusy);
 useEffect(()=>{changed.current=onChanged;busyRef.current=onBusy},[onChanged,onBusy]);
 const copy={...form,topics:tags.split(/[\s,，]+/u).filter(Boolean).map(t=>t.replace(/^#+/,''))};
 const dirty=!!plan&&JSON.stringify([copy,ai,account])!==original.current;
 useEffect(()=>onDirty(dirty),[dirty,onDirty]);
 useEffect(()=>{
  const abort=new AbortController(),n=++sequence.current;setLoading(true);setError('');
  void (async()=>{try{const r=await fetch('/api/video-works/'+workId+'/douyin'+(account?'?accountId='+encodeURIComponent(account):''),{signal:abort.signal,cache:'no-store'}),d=await r.json();if(!r.ok)throw Error(d.error);if(abort.signal.aborted||n!==sequence.current)return;
   setPlan(d.plan);setForm(d.plan.content);setTags(d.plan.content.topics.join(' '));setAi(d.plan.aiGenerated);setAllowed(d.canOperate);setOperation(d.operation);setUnknown(d.operation?.state==='unknown');setReview(false);setAccepted(false);
   if(!account&&d.plan.accountId)setAccount(d.plan.accountId);
   original.current=JSON.stringify([d.plan.content,d.plan.aiGenerated,d.plan.accountId]);
  }catch(e){if(!abort.signal.aborted)setError(text(e))}finally{if(!abort.signal.aborted)setLoading(false)}})();
  return()=>abort.abort();
 },[workId,account]);
 const refresh=useCallback(async()=>{
  const n=sequence.current;try{const r=await fetch('/api/video-works/'+workId+'/douyin'+(account?'?accountId='+encodeURIComponent(account):''),{cache:'no-store'}),d=await r.json();if(!r.ok)throw Error(d.error);if(n!==sequence.current)return;setOperation(d.operation);setUnknown(d.operation?.state==='unknown');await changed.current()}catch(e){setError(text(e))}
 },[workId,account]);
 useEffect(()=>{if(!pending(operation?.state))return;const timer=setTimeout(()=>void refresh(),5000);return()=>clearTimeout(timer)},[operation,refresh]);
 function modify(next:ChannelCopy){setForm(next);setReview(false);setAccepted(false);if(!pending(operation?.state)&&!unknown)setOperation(null)}
 async function submit(action:'prepare'|'publish'){
  if(busy||!allowed||unknown||pending(operation?.state)||(action==='publish'&&!accepted))return;
  setBusy(true);busyRef.current(true);setError('');
  try{const payload={...copy,cover:copy.cover&&Object.values(copy.cover).some(Boolean)?copy.cover:undefined,accountId:account,aiGenerated:ai,action,...action==='publish'?{confirmPublish:true}:{confirmPrepare:true}};
   const r=await fetch('/api/video-works/'+workId+'/douyin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
   const d=await r.json();if(!r.ok){if(r.status>=500)setUnknown(true);throw Error(d.error||'publication_operation_failed')}
   setOperation(d.operation);setReview(false);setAccepted(false);original.current=JSON.stringify([copy,ai,account]);onDirty(false);await changed.current();
  }catch(e){setError(text(e));if(e instanceof TypeError||e instanceof SyntaxError)setUnknown(true)}finally{setBusy(false);busyRef.current(false)}
 }
 if(loading)return <section className="vw-publish-panel" aria-busy="true"><p className="vw-muted">正在读取抖音账号、原片与渠道方案…</p></section>;
 if(!plan)return <section className="vw-error" role="alert">{error}</section>;
 const locked=busy||unknown||pending(operation?.state)||!allowed,invalid=!account||!copy.title.trim()||Array.from(copy.title).length>DOUYIN_VIDEO_OPTIONS.title.maxCharacters||copy.description.length>DOUYIN_VIDEO_OPTIONS.description.maxCharacters||copy.topics.length>DOUYIN_VIDEO_OPTIONS.topics.maxItems||copy.topics.some(t=>!/^[\p{L}\p{N}_]{1,30}$/u.test(t))||!plan.originalRetained||(plan.originalBytes||0)>DOUYIN_VIDEO_OPTIONS.maxBytes;
 const url=operation?.receipt?.videoUrl||operation?.receipt?.url;
 return <section className="vw-publish-panel" aria-label="抖音视频发布设置">
  <header className="vw-publish-heading"><div><h3>抖音视频发布</h3><p className="vw-muted">复用原片；以下是这一次投递的内容。</p></div><span className="vw-tag info">正式工作流</span></header>
  {!allowed&&<div className="vw-access-note"><strong>设置与操作入口已在这里</strong><p>查看无需登录。准备或发布时，请在已连接的 Agent 中发送下面这句话，打开它返回的操作入口。</p><blockquote>为我开启视频作品中心的抖音发布和内容编辑操作</blockquote><p>旧的公众号草稿入口不会自动获得抖音发布权限。</p></div>}
  <fieldset className="vw-publish-account"><legend>发布账号</legend>{plan.accounts.length?plan.accounts.map(a=><label key={a}><input type="radio" name={'douyin-account-'+workId} value={a} checked={account===a} disabled={locked} onChange={()=>setAccount(a)}/><span>抖音账号 <strong>{a}</strong></span><small>已有核验回执</small></label>):<p className="vw-muted">暂无已核验账号。请先由 Agent 核对抖音登录账号。</p>}</fieldset>
  <div className="vw-publish-original"><span className={'vw-dot '+(plan.originalRetained?'ready':'')}/><span>{plan.originalRetained?'原片已留存 · '+((plan.originalBytes||0)/1048576).toFixed(1)+' MB':'原片仍待留存'}</span><span>不自动压缩</span></div>
  {error&&<p className="vw-error" role="alert">{error}</p>}
  <label className="vw-field"><span><strong>作品标题</strong><small>{Array.from(form.title).length}/30</small></span><input readOnly={locked} value={form.title} onChange={e=>modify({...form,title:e.target.value})}/></label>
  <label className="vw-field"><span><strong>作品正文</strong><small>{form.description.length}/900</small></span><textarea rows={5} readOnly={locked} value={form.description} onChange={e=>modify({...form,description:e.target.value})}/></label>
  <label className="vw-field"><span><strong>话题标签</strong><small>{copy.topics.length}/5 · 空格分隔</small></span><input readOnly={locked} value={tags} placeholder="原创故事 生活记录" onChange={e=>{setTags(e.target.value);setReview(false);setAccepted(false);setOperation(null)}}/></label>
  <div className="vw-cover-grid">{(['verticalUrl','horizontalUrl'] as const).map(k=><label className="vw-field" key={k}><span><strong>{k==='verticalUrl'?'竖版封面 · 3:4':'横版封面 · 4:3'}</strong><small>可选 · 上传后核验</small></span><input readOnly={locked} value={form.cover?.[k]||''} placeholder="HTTPS JPG / PNG 地址" onChange={e=>modify({...form,cover:{...form.cover,[k]:e.target.value}})}/>{form.cover?.[k]&&/^https:\/\/(resource|cdn)\.vyibc\.com\/[^?#]+\.(png|jpe?g)$/i.test(form.cover[k]!)&&<Image src={form.cover[k]!} unoptimized width={160} height={110} className="vw-publish-cover" alt={k==='verticalUrl'?'抖音竖版封面':'抖音横版封面'}/>}</label>)}</div>
  <p className="vw-muted">封面仅接受自有资源域 JPG / PNG，每张最多8 MiB；不填写则使用平台默认封面。将分别上传并核验预览；建议按目标比例设计，避免裁切重要文字。</p>
  <label className="vw-ai-option"><input type="checkbox" checked={ai} disabled={locked||plan.aiGenerated} onChange={e=>{setAi(e.target.checked);setReview(false);setAccepted(false);setOperation(null)}}/><span><strong>平台 AI 内容声明</strong><small>{plan.aiGenerated?'作品记录为 AI 内容，保留声明。':'请根据实际制作方式如实选择。'} 标识不会写进标题或正文。</small></span></label>
  <details className="vw-support-details"><summary>还有哪些设置尚未接入？</summary><p>MCP已接入可见范围、保存权限、已有合集与定时设置，可通过settings传入；本侧栏暂未提供这些输入框。位置、商品关联、评论和跨平台同时发布尚未接入，不会替你设置。</p><p>“准备发布页”不等于保存抖音云草稿；正式提交后，平台审核和公开可见性仍需单独确认。</p></details>
  {operation&&<div className={'vw-operation '+(operation.state==='published'?'success':operation.state==='unknown'||operation.state==='error'||operation.state==='failed'?'warning':'info')} role="status"><strong>{labels[operation.state]||operation.state}</strong>{operation.requestId&&<p>请求：{operation.requestId}</p>}{operation.taskId&&<p>任务：{operation.taskId}</p>}{url&&/^https:\/\/www\.douyin\.com\/video\/\d+$/.test(url)&&<a className="vw-link" href={url} target="_blank" rel="noreferrer">打开抖音作品 ↗</a>}<button className="vw-link" onClick={()=>void refresh()}>查询原任务状态</button></div>}
  {unknown&&<p className="vw-note" role="status">提交结果待核实，已停用再次提交。请查询原任务或查看“分发记录”，不要换内容重发。</p>}
  {review&&<section className="vw-publication-review" aria-label="抖音发布前核对"><h4>确认这次公开发布</h4><dl><dt>目标账号</dt><dd>{account}</dd><dt>发布标题</dt><dd>{copy.title}</dd><dt>正文与标签</dt><dd>{copy.description||'无正文'}<br/>{copy.topics.map(t=>'#'+t).join(' ')}</dd><dt>封面</dt><dd>{form.cover?.verticalUrl?'自定义竖版':'平台默认竖版'} / {form.cover?.horizontalUrl?'自定义横版':'平台默认横版'}</dd></dl><label><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)}/>我确认将以上内容公开发布到这个抖音账号</label><div className="vw-inline"><button className="vw-btn" onClick={()=>{setReview(false);setAccepted(false)}}>返回修改</button><button className="vw-btn primary" disabled={!accepted||busy||invalid} onClick={()=>void submit('publish')}>确认发布到抖音</button></div></section>}
  <footer className="vw-publish-actions"><button className="vw-btn" disabled={locked||invalid} onClick={()=>void submit('prepare')}>{busy?'正在提交…':'准备抖音发布页'}</button><button className="vw-btn primary" disabled={locked||invalid} onClick={()=>{setReview(true);setAccepted(false)}}>检查并发布</button></footer>
  <button className="vw-link" onClick={onManage}>查看已保存的抖音渠道方案</button>
 </section>;
}
