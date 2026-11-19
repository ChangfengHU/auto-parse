import type {Page} from 'playwright';
import {withCollections,openCollectionEditor,collectionEditorState,openCandidateDialog,candidatePage,listCollectionItems} from './collection-browser';
import {parseCollectionBatch,reserveCollectionBatch,readCollectionBatch,updateCollectionBatch,collectionBatchView,type BatchInput} from './collection-batch-ledger';
declare global{var __wechatCollectionQueue:Promise<void>|undefined;var __wechatCollectionQueued:number|undefined}
type Candidate={contentId:string;title:string;page:number;selectable:boolean;groupSize:number};
export function assertCollectionMembership(before:string[],after:string[],added:string[]){
 if(new Set(before).size!==before.length||new Set(after).size!==after.length||new Set(added).size!==added.length||[...before,...after,...added].some(x=>! /^\d{1,30}_\d{1,4}$/.test(x)))throw Error('wechat_collection_membership_unverified');
 const old=new Set(before),newItems=new Set(added);
 if(added.some(x=>old.has(x))||after.length!==before.length+added.length||after.some(x=>!old.has(x)&&!newItems.has(x))||after.filter(x=>old.has(x)).join(',')!==before.join(','))throw Error('wechat_collection_membership_mismatch');
}
export function validateCollectionBatchPayload(body:string,collectionId:string,ids:string[],base:Record<string,unknown>){
 const form=new URLSearchParams(body);if(form.get('id')!==collectionId)throw Error('wechat_collection_payload_mismatch');
 let keys:unknown;try{keys=JSON.parse(form.get('appmsg_info')||'').appmsgkeys}catch{throw Error('wechat_collection_payload_mismatch')}
 if(!Array.isArray(keys))throw Error('wechat_collection_payload_mismatch');
 const actual=keys.map(k=>String(k.msgid)+'_'+String(k.itemidx));if(actual.join(',')!==ids.join(','))throw Error('wechat_collection_payload_mismatch');
 for(const key of ['id','title','desc','type','is_updating','is_reverse','is_numbered','continous_read_on','update_time','sync_version'])if(base[key]!==undefined&&form.get(key)!==String(base[key]))throw Error('wechat_collection_metadata_or_revision_changed');
}
export function collectionBatchStatus(account:string,requestId:string){return collectionBatchView(readCollectionBatch(account,requestId))}
export function startCollectionBatch(raw:Record<string,unknown>){
 const input=parseCollectionBatch(raw);if((global.__wechatCollectionQueued||0)>=20)throw Error('wechat_collection_queue_full');
 const reserved=reserveCollectionBatch(input);if(!reserved.fresh)return {...collectionBatchView(reserved.record),reused:true};
 global.__wechatCollectionQueued=(global.__wechatCollectionQueued||0)+1;
 global.__wechatCollectionQueue=(global.__wechatCollectionQueue||Promise.resolve()).catch(()=>{}).then(()=>runCollectionBatch(input)).catch(()=>{}).finally(()=>{global.__wechatCollectionQueued=Math.max(0,(global.__wechatCollectionQueued||1)-1)});
 return {...collectionBatchView(reserved.record),reused:false,pollIntervalMs:3000};
}
async function runCollectionBatch(input:BatchInput){
 let phase='opening_collection';const update=(value:Parameters<typeof updateCollectionBatch>[1])=>updateCollectionBatch(input,value);
 const step=(value:string)=>{phase=value;update({state:'running',phase:value})};
 try{step(phase);await withCollections(input.account,async root=>{
 let editor:Page|undefined;try{
 editor=await openCollectionEditor(root,input.collectionId);const before=await collectionEditorState(editor);
 if(before.id!==input.collectionId||before.type!==0||!before.complete||!before.saveData)throw Error('wechat_collection_article_members_unverified');
 const beforeIds=before.items.map(x=>x.contentId);assertCollectionMembership(beforeIds,beforeIds,[]);
 const remaining=input.contentIds.filter(x=>!beforeIds.includes(x)),found=new Map<string,Candidate>();let pagesRead=0,exhausted=false;
 step('reading_candidates');
 if(remaining.length){await openCandidateDialog(editor);const deadline=Date.now()+240000;
  for(let n=1;n<=input.maxPages;n++){
   if(Date.now()>deadline)throw Error('wechat_collection_candidate_deadline');
   const page=await candidatePage(editor,n,input.query||'');pagesRead++;
   for(const group of page.groups)for(const a of group.articles)if(remaining.includes(a.contentId))found.set(a.contentId,{contentId:a.contentId,title:a.title,page:n,selectable:group.selectable,groupSize:group.articles.length});
   exhausted=!page.hasMore;if(found.size===remaining.length||exhausted)break;
  }
 }
 const items=input.contentIds.map(contentId=>{const existing=before.items.find(x=>x.contentId===contentId),candidate=found.get(contentId);return {contentId,title:existing?.title||candidate?.title||null,status:existing?'already_added':!candidate?(exhausted?'not_eligible_candidate':'not_observed_scan_limit'):candidate.groupSize!==1?'unsupported_multi_article_group':!candidate.selectable?'not_selectable':'eligible'}});
 const blocked=items.filter(x=>!['eligible','already_added'].includes(x.status)),add=items.filter(x=>x.status==='eligible').map(x=>x.contentId);
 const plan={collectionId:input.collectionId,collectionTitle:before.title,items,beforeCount:beforeIds.length,addCount:add.length,alreadyAdded:items.filter(x=>x.status==='already_added').map(x=>x.contentId),pagesRead,candidateHistoryExhausted:exhausted,allEligible:blocked.length===0};
 if(input.dryRun){update({state:'completed',phase:'preview_complete',result:{status:'planned',...plan,changed:false}});return}
 if(blocked.length){update({state:'failed',phase:'preflight_rejected',error:'wechat_collection_items_not_eligible',result:plan});return}
 if(!add.length){update({state:'completed',phase:'already_added',result:{status:'already_added',...plan,added:[],changed:false,verified:'native_editor_readback'}});return}
 step('selecting_members');
 for(const pageNo of Array.from(new Set(add.map(id=>found.get(id)!.page))).sort((a,b)=>a-b)){
  const page=await candidatePage(editor,pageNo,input.query||'');
  for(const contentId of add.filter(id=>found.get(id)!.page===pageNo)){
   const group=page.groups.filter(g=>g.articles.some(a=>a.contentId===contentId));if(group.length!==1||group[0].articles.length!==1||!group[0].selectable)throw Error('wechat_collection_candidate_changed');
   const boxes=editor.locator('.publish_dialog .appmsg-list-publish input[type=checkbox]');if(await boxes.count()!==page.groups.length)throw Error('wechat_collection_candidate_controls_changed');
   const box=boxes.nth(group[0].index);if(await box.isDisabled())throw Error('wechat_collection_candidate_disabled');if(!await box.isChecked())await box.evaluate((e:HTMLInputElement)=>e.click());
  }
 }
 const selected=await editor.evaluate(()=>{const d=(document.querySelector('.publish_dialog') as unknown as {__vue__?:{$data:Record<string,unknown>}})?.__vue__?.$data;
 return ((d?.selectedList||[]) as Record<string,unknown>[]).flatMap(r=>((Array.isArray(r.appmsgex)&&r.appmsgex.length?r.appmsgex:Array.isArray(r.appmsg_info)?r.appmsg_info:[]) as Record<string,unknown>[]).map(a=>String(a.aid||String(a.appmsgid)+'_'+String(a.itemidx))))});
 if(new Set(selected).size!==selected.length||selected.length!==beforeIds.length+add.length||[...beforeIds,...add].some(x=>!selected.includes(x)))throw Error('wechat_collection_selection_mismatch');
 await editor.locator('.publish_dialog').getByRole('button',{name:'确定',exact:true}).click({timeout:12000});
 await editor.locator('.publish_dialog:visible').waitFor({state:'hidden',timeout:15000});
 const staged=await collectionEditorState(editor),wanted=staged.items.map(x=>x.contentId);assertCollectionMembership(beforeIds,wanted,add);
 if(staged.id!==before.id||staged.revision!==before.revision)throw Error('wechat_collection_revision_changed');
 step('saving_collection');let attempted=false,receipt:{httpStatus:number;wechatCode:unknown}|undefined;
 let settle:(value:unknown)=>void=()=>{};const accepted=new Promise(resolve=>{settle=resolve});
 await editor.route('**/cgi-bin/masssend**',route=>route.abort());
 await editor.route('**/cgi-bin/appmsgalbummgr**',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(request.method()!=='POST'||url.searchParams.get('action')!=='commit')return route.continue();
  try{
   if(url.origin!=='https://mp.weixin.qq.com'||attempted)throw Error('wechat_collection_duplicate_submission_blocked');
   validateCollectionBatchPayload(request.postData()||'',input.collectionId,wanted,before.saveData!);
   update({state:'submitting',phase:'submitting',finalAttempted:true,result:plan});attempted=true;
   const response=await route.fetch({maxRetries:0,maxRedirects:0,timeout:45000}),body=await response.json();
   receipt={httpStatus:response.status(),wechatCode:body?.base_resp?.ret??body?.ret};settle(receipt);await route.fulfill({response});
  }catch(error){settle({error:error instanceof Error?error.message:'wechat_collection_transport_unknown'});await route.abort().catch(()=>{})}
 });
 const publish=editor.getByRole('button',{name:'发布',exact:true});if(await publish.count()!==1)throw Error('wechat_collection_save_control_ambiguous');
 await publish.click({trial:true,timeout:12000});await publish.click({timeout:12000});
 let timer:ReturnType<typeof setTimeout>|undefined;const outcome=await Promise.race([accepted,new Promise(resolve=>{timer=setTimeout(()=>resolve({error:'wechat_collection_response_timeout'}),50000)})]);if(timer)clearTimeout(timer);
 if(!receipt)throw Error(typeof outcome==='object'&&outcome&&'error' in outcome?String(outcome.error):'wechat_collection_response_unknown');
 if(receipt.httpStatus!==200||!(receipt.wechatCode===0||receipt.wechatCode==='0')){
  update({state:'failed',phase:'wechat_rejected',error:'wechat_collection_upstream_rejected',diagnostic:receipt,result:plan});return;
 }
 phase='verifying_members';update({phase});await editor.close().catch(()=>{});editor=undefined;
 await root.reload({waitUntil:'domcontentloaded',timeout:30000});await root.locator('td.album-title:visible').filter({hasText:before.title}).first().waitFor({timeout:30000});
 editor=await openCollectionEditor(root,input.collectionId);const after=await collectionEditorState(editor);
 if(after.id!==input.collectionId||!after.complete||after.items.map(x=>x.contentId).join(',')!==wanted.join(','))throw Error('wechat_collection_saved_members_unconfirmed');
 update({state:'completed',phase:'verified',result:{status:'added',...plan,added:add,afterCount:after.items.length,changed:true,receipt,verified:'wechat_success_and_reopened_editor',revisionBefore:before.revision,revisionAfter:after.revision}});
 }finally{await editor?.close().catch(()=>{})}
 });
 }catch(error){
 const record=readCollectionBatch(input.account,input.requestId);if(record&&!['completed','failed','unknown'].includes(record.state)){
 const message=error instanceof Error?error.message:'',code=/^[a-z0-9_]+$/.test(message)?message:'wechat_collection_browser_step_failed';
 update({state:record.finalAttempted?'unknown':'failed',phase,error:code,diagnostic:{stage:phase,submissionState:record.finalAttempted?'unknown':'not_submitted',errorName:error instanceof Error?error.name:null,detail:message.split('\n').filter(s=>!/https?:|cookie|token|ticket|authorization/i.test(s)).slice(0,8).join('\n').slice(0,1200)}});
 }
 }
}
export async function reconcileCollectionBatch(input:Record<string,unknown>){
 const account=String(input.expectedAccount||''),requestId=String(input.requestId||''),r=readCollectionBatch(account,requestId);if(!r)return {found:false};
 if(!['unknown','submitting'].includes(r.state))return collectionBatchView(r);
 const current=await listCollectionItems({expectedAccount:account,collectionId:r.input.collectionId}),present=new Set(current.items.map(x=>x.contentId));
 return {...collectionBatchView(r),reconciliation:{checkedAt:new Date().toISOString(),desiredMembersPresent:r.input.contentIds.every(x=>present.has(x)),members:current.items,complete:current.complete,note:'Current membership observation only. This does not identify which operation added an item; no mutation or resubmission.'}};
}
