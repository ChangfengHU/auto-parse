'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
type Plan={workId:string;expectedAccount:string;requestId:string;title:string;description:string;needsAdaptation:boolean;originalRetained:boolean;originalBytes:number|null};
type Draft={requestId?:string;status?:string;phase?:string;receipt?:{appMsgId?:string;saveResponseAccepted?:boolean;nativeEditorReloadVerified?:boolean};error?:{code?:string;message?:string}};
const phases:Record<string,string>={reserved:'等待执行',checking_account:'检查公众号登录',downloading:'读取原片',uploading_material:'准备上传',uploading_video_file:'上传视频',waiting_video_upload:'等待视频上传',loading_video_cover:'读取推荐封面',selecting_video_cover:'选择封面',cropping_video_cover:'处理封面',saving_material:'保存视频素材',waiting_transcode:'等待微信转码',saving_draft:'保存草稿',verifying_draft:'重新打开核对',completed:'草稿已保存'};
const messages:Record<string,string>={video_work_web_signin_required:'操作会话尚未启用或已过期，请重新打开MCP提供的限时操作入口。',wechat_default_account_not_unique:'还没有唯一的默认公众号账号，需要先在服务端确认目标账号。',work_original_not_retained_poll_work_first:'原片仍在留存，请稍后查看。',wechat_original_exceeds_100mib_no_automatic_quality_loss:'原片超过公众号当前100 MiB限制，没有自动压缩或降低画质。',video_work_not_found:'这条作品未找到，请刷新作品列表。'};
function message(code:string){return messages[code]||'操作未完成：'+code}
const pending=(s?:string)=>s==='reserved'||s==='running';
export default function WechatDraftPanel({workId,canOperate,autoStart=false,onChanged,onDirty}:{workId:string;canOperate:boolean;autoStart?:boolean;onChanged:()=>Promise<void>;onDirty?:(dirty:boolean)=>void}){
 const [plan,setPlan]=useState<Plan|null>(null),[title,setTitle]=useState(''),[description,setDescription]=useState(''),[draft,setDraft]=useState<Draft|null>(null),[loading,setLoading]=useState(false),[submitting,setSubmitting]=useState(false),[error,setError]=useState('');
 const baseline=useRef('');useEffect(()=>{onDirty?.(!!plan&&JSON.stringify([title,description])!==baseline.current)},[plan,title,description,onDirty]);
 const currentRequest=useRef(''),started=useRef(false),mounted=useRef(true);
 const endpoint='/api/video-works/'+workId+'/wechat-draft';
 const changed=useRef(onChanged);useEffect(()=>{changed.current=onChanged},[onChanged]);
 const create=useCallback(async(t:string,d:string)=>{
  if(started.current)return;started.current=true;setSubmitting(true);setError('');
  try{
   const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmDraft:true,title:t,description:d})}),data=await response.json();
   if(!mounted.current)return;if(!response.ok)throw Error(message(data.error||'video_work_operation_failed'));
   if(data.created===false){setError('请将标题调整到20字以内、正文调整到300字以内，再保存。');return}
   baseline.current=JSON.stringify([t,d]);onDirty?.(false);currentRequest.current=data.requestId||'';setDraft(data.result||{status:'unknown',requestId:data.requestId});await changed.current();
  }catch(e){if(mounted.current)setError((e instanceof Error?e.message:'请求结果暂未确认')+' 请先查看原任务状态，勿更换文案重复提交。')}
  finally{started.current=false;if(mounted.current)setSubmitting(false)}
 },[endpoint,onDirty]);
 useEffect(()=>{
  mounted.current=true;if(!canOperate)return()=>{mounted.current=false};const controller=new AbortController();setLoading(true);
  void (async()=>{try{
   const response=await fetch(endpoint,{cache:'no-store',signal:controller.signal}),data=await response.json();if(!response.ok)throw Error(message(data.error||'video_work_operation_failed'));if(controller.signal.aborted)return;
   baseline.current=JSON.stringify([data.plan.title,data.plan.description]);setPlan(data.plan);setTitle(data.plan.title);setDescription(data.plan.description);currentRequest.current=data.plan.requestId;
   const existing=data.drafts.items.find((d:Draft)=>d.requestId===data.plan.requestId);if(existing)setDraft(existing);
   if(autoStart&&!data.plan.needsAdaptation&&data.plan.originalRetained&&data.plan.originalBytes<=104857600&&!controller.signal.aborted)await create(data.plan.title,data.plan.description);
  }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'读取草稿状态失败')}finally{if(!controller.signal.aborted)setLoading(false)}})();
  return()=>{controller.abort();mounted.current=false};
 },[canOperate,endpoint,autoStart,create]);
 const refresh=useCallback(async()=>{
  setError('');try{const response=await fetch(endpoint,{cache:'no-store'}),data=await response.json();if(!response.ok)throw Error(message(data.error||'video_work_operation_failed'));if(!mounted.current)return;
   const item=data.drafts.items.find((d:Draft)=>d.requestId===currentRequest.current);if(item)setDraft(item);await changed.current();
  }catch(e){if(mounted.current)setError(e instanceof Error?e.message:'状态暂时读取失败')}
 },[endpoint]);
 useEffect(()=>{if(!pending(draft?.status))return;const timer=setTimeout(()=>void refresh(),5000);return()=>clearTimeout(timer)},[draft,refresh]);
 const saved=draft?.status==='completed'&&draft.receipt?.saveResponseAccepted===true&&draft.receipt?.nativeEditorReloadVerified===true;
 const locked=submitting||pending(draft?.status),invalid=!title.trim()||title!==title.trim()||/[\r\n]/.test(title)||Array.from(title).length>20||Array.from(description).length>300;
 return <section className="rounded-xl border border-primary/25 bg-primary/[.025] p-4 space-y-4 min-w-0" aria-label="公众号视频草稿">
  <div><h3 className="font-semibold">存到公众号草稿</h3><p className="text-sm text-muted-foreground mt-1">直接复用原片与文案，保存后自动核对。仅存草稿。</p></div>
  {!canOperate?<div className="space-y-3"><p className="text-sm">先启用一次网页操作，再在这里点击保存。</p><p className="text-sm text-muted-foreground">在已连接MCP的会话中发送：</p><blockquote className="rounded-lg border border-border bg-background p-3 text-sm select-all">为我开启视频作品中心的网页草稿操作</blockquote><p className="text-xs text-muted-foreground">打开返回的限时入口后，8小时内可在本页操作。无需填写后台服务密钥。</p></div>:<>
  {loading&&<p role="status" className="text-sm text-muted-foreground">正在读取原片、公众号与已有草稿…</p>}
  {plan&&<><p className="text-xs text-muted-foreground break-all">目标公众号：{plan.expectedAccount} · {plan.originalRetained?'已复用留存原片':'原片仍待留存'}</p>
  <label className="block text-sm">公众号标题 <span className={Array.from(title).length>20?'text-red-700':'text-muted-foreground'}>{Array.from(title).length}/20</span><input value={title} disabled={locked} onChange={e=>{setTitle(e.target.value);setDraft(null)}} className="block w-full mt-1 border border-border rounded-lg bg-background px-3 py-2 disabled:opacity-60"/></label>
  <label className="block text-sm">公众号正文 <span className={Array.from(description).length>300?'text-red-700':'text-muted-foreground'}>{Array.from(description).length}/300</span><textarea rows={4} value={description} disabled={locked} onChange={e=>{setDescription(e.target.value);setDraft(null)}} className="block w-full mt-1 border border-border rounded-lg bg-background px-3 py-2 disabled:opacity-60"/></label>
  {invalid&&<p className="text-sm text-amber-800">公众号标题最多20字，正文最多300字。原文已保留，请调整本次草稿文案。</p>}
  {(plan.originalBytes||0)>104857600&&<p className="text-sm text-amber-800">原片超过100 MiB，暂不能保存；未自动压缩。</p>}
  <button type="button" onClick={()=>void (saved||draft?.status==='failed'?refresh():create(title,description))} disabled={locked||invalid||!plan.originalRetained||(plan.originalBytes||0)>104857600||draft?.status==='unknown'} className="vw-btn primary w-full py-3 text-sm font-semibold disabled:opacity-50">{submitting?'正在提交…':pending(draft?.status)?'正在保存，请稍候':saved?'查看已保存草稿':draft?.status==='failed'?'查询原草稿任务':'保存视频草稿'}</button>
  </>}
  {draft&&<div role="status" className={'rounded-lg border p-3 text-sm space-y-2 '+(saved?'border-green-300 bg-green-50 text-green-900':draft.status==='failed'||draft.status==='unknown'?'border-amber-300 bg-amber-50 text-amber-900':'border-border bg-background')}>
   <strong>{saved?'视频草稿已保存并核对通过':draft.status==='failed'?'草稿未保存':draft.status==='unknown'?'结果待确认，请勿重复创建':phases[draft.phase||'']||'任务处理中'}</strong>
   {saved&&<p>草稿ID：{draft.receipt?.appMsgId}。可以到公众号后台继续编辑。</p>}
   {draft.status==='failed'&&<p>{draft.phase==='checking_account'?'公众号网页账号检查未通过，请先在84机器浏览器1确认登录。没有保存草稿。':draft.error?.message||'请查看原任务记录，先处理失败原因。'}</p>}
   {draft.status==='unknown'&&<p>保存结果尚未核对，不会自动重建草稿。</p>}
   {draft.requestId&&<p className="text-xs break-all">请求号：{draft.requestId}</p>}
  </div>}
  {error&&<p role="alert" className="text-sm text-red-700 whitespace-pre-wrap break-words">{error}</p>}
  <button type="button" onClick={()=>void refresh()} disabled={submitting} className="text-sm text-primary underline underline-offset-4">查询原任务状态</button>
  </>}
 </section>;
}
