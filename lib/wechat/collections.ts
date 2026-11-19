import path from 'node:path';
import {readCollectionIntent,reserveCollectionIntent,finishCollectionIntent} from './collection-ledger';

type Collection = {id:string; title:string; type:number; total:number; updatedAt:string};
import {withCollections,collectionAccount as account,readCollectionCandidates,listCollectionItems} from './collection-browser';
import {startCollectionBatch,collectionBatchStatus,reconcileCollectionBatch} from './collection-membership';
export async function listWechatCollections(input:Record<string,unknown>){
 const expected=account(input.expectedAccount);
 return withCollections(expected,async page=>{
  const result=await page.evaluate(()=>{
   for(const e of Array.from(document.querySelectorAll('div'))){
    const d=(e as unknown as {__vue__?:{$data?:Record<string,unknown>}}).__vue__?.$data;
    if(!d||!Array.isArray(d.totalList)||typeof d.totalAll!=='number')continue;
    const rows=d.totalList as Array<Record<string,unknown>>;
    return {total:d.totalAll,rows:rows.map(a=>({id:String(a.id||''),title:String(a.title||''),type:Number(a.type),total:Number(a.total||0),updatedAt:String(a.update_time||'')}))};
   }
   throw Error('collection_data_unavailable');
  });
  const rows=result.rows as Collection[];
  return {account:expected,items:rows,total:result.total,complete:rows.length>=Number(result.total),note:'Read-only browser observation. If complete=false, additional collection pages have not been read.'};
 });
}

export const listWechatCollectionCandidates=readCollectionCandidates;
export const listWechatCollectionItems=listCollectionItems;
export const addWechatCollectionItems=startCollectionBatch;

const collectionLedgerRoot=()=>path.join(process.cwd(),'.data/wechat-collection-requests');
export async function wechatCollectionRequestStatus(input:Record<string,unknown>){
 const expected=account(input.expectedAccount),id=String(input.requestId||'');
 const batch=collectionBatchStatus(expected,id);if(batch.found)return input.reconcile===true?reconcileCollectionBatch(input):batch;
 const record=readCollectionIntent(collectionLedgerRoot(),expected,id);
 return record?{found:true,...record,note:'submitting or unknown requires manual reconciliation; never change requestId and resubmit.'}:{found:false,requestId:id};
}
export function validateCollectionReceipt(ret:unknown,before:string[],after:{id:string;title:string}[],name:string,complete:boolean){
 if(!(ret===0||ret==='0')||!complete)throw Error('wechat_collection_result_unknown');
 const added=after.filter(item=>item.title===name&&!before.includes(item.id));
 if(added.length!==1||!/^[0-9]{1,30}$/.test(added[0].id))throw Error('wechat_collection_result_unknown');
 return added[0].id;
}
export async function pollCollectionReceipt(ret:unknown,before:string[],name:string,snapshot:()=>Promise<{items:{id:string;title:string}[];complete:boolean}>,refresh:()=>Promise<void>,attempts=6){
 if(!(ret===0||ret==='0'))throw Error('wechat_collection_result_unknown');
 for(let attempt=0;attempt<attempts;attempt++){
  const after=await snapshot();
  try{return validateCollectionReceipt(ret,before,after.items,name,after.complete)}catch{
   if(attempt===attempts-1)throw Error('wechat_collection_result_unknown');
   await refresh();
  }
 }
 throw Error('wechat_collection_result_unknown');
}
export async function createWechatCollection(input:Record<string,unknown>){
 const expected=account(input.expectedAccount),id=String(input.requestId||''),name=typeof input.name==='string'?input.name.trim():'',description=input.description===undefined?'':input.description;
 if(input.confirmCreate!==true)throw Error('wechat_collection_confirmation_required');
 if(!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(id))throw Error('wechat_invalid_request_id');
 if(!name||Array.from(name).length>30)throw Error('wechat_collection_invalid_name');
 if(typeof description!=='string'||Array.from(description).length>200)throw Error('wechat_collection_invalid_description');
 const data={name,description,type:'article'},root=collectionLedgerRoot();
 const prior=readCollectionIntent(root,expected,id);
 if(prior){const existing=reserveCollectionIntent(root,expected,id,data);return {reused:true,...existing,note:'Do not resubmit an unresolved collection request.'};}
 return withCollections(expected,async page=>{
  const existing=readCollectionIntent(root,expected,id);
  if(existing){const same=reserveCollectionIntent(root,expected,id,data);return {reused:true,...same,note:'Do not resubmit an unresolved collection request.'};}
  const snapshot=async()=>page.evaluate(()=>{
   for(const el of Array.from(document.querySelectorAll('div'))){
    const d=(el as unknown as {__vue__?:{$data?:Record<string,unknown>}}).__vue__?.$data;
    if(d&&Array.isArray(d.totalList)&&typeof d.totalAll==='number'){
     const rows=(d.totalList as Array<Record<string,unknown>>).map(x=>({id:String(x.id||''),title:String(x.title||'')}));
     return {items:rows,complete:rows.length>=d.totalAll};
    }
   }
   throw Error('wechat_collection_list_unavailable');
  });
  const before=await snapshot();if(!before.complete)throw Error('wechat_collection_list_incomplete');
  if(before.items.some(x=>x.title===name))throw Error('wechat_collection_name_already_exists');
  await page.getByText('创建合集',{exact:true}).first().click({timeout:12000});
  const choice=page.locator('.weui-desktop-dropdown__list-ele__text:visible').filter({hasText:'文章合集'});
  if(await choice.count()!==1)throw Error('wechat_collection_create_menu_ambiguous');
  const [editor]=await Promise.all([page.waitForEvent('popup',{timeout:15000}),choice.click({timeout:12000})]);
  try{
   const nameInput=editor.getByPlaceholder('填写名称');await nameInput.waitFor({state:'visible',timeout:30000});
   await nameInput.fill(name);if(description)await editor.getByPlaceholder('填写简介').fill(description);
   if(await nameInput.inputValue()!==name)throw Error('wechat_collection_name_verify_failed');
   const publish=editor.getByRole('button',{name:'发布',exact:true});if(await publish.count()!==1)throw Error('wechat_collection_publish_button_ambiguous');
   const reserved=reserveCollectionIntent(root,expected,id,data);if(reserved.state!=='submitting')return {reused:true,...reserved};
   try{
    const [response]=await Promise.all([editor.waitForResponse(r=>{try{return new URL(r.url()).pathname==='/cgi-bin/appmsgalbummgr'&&r.request().method()==='POST';}catch{return false;}},{timeout:30000}),publish.click({timeout:15000})]);
    if(!response.ok())throw Error('wechat_collection_result_unknown');
    const result=await response.json() as Record<string,unknown>,base=result.base_resp as Record<string,unknown>|undefined;
    const code=base?.ret??result.ret;await page.reload({waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForFunction(()=>Array.from(document.querySelectorAll('div')).some(e=>{const d=(e as unknown as {__vue__?:{$data?:Record<string,unknown>}}).__vue__?.$data;return d&&Array.isArray(d.totalList)&&typeof d.totalAll==='number';}),null,{timeout:30000});
    const collectionId=await pollCollectionReceipt(code,before.items.map(x=>x.id),name,snapshot,async()=>{
     await page.waitForTimeout(2000);await page.reload({waitUntil:'domcontentloaded',timeout:30000});
     await page.waitForFunction(()=>Array.from(document.querySelectorAll('div')).some(e=>{const d=(e as unknown as {__vue__?:{$data?:Record<string,unknown>}}).__vue__?.$data;return d&&Array.isArray(d.totalList)&&typeof d.totalAll==='number';}),null,{timeout:30000});
    });
    const receipt={collectionId,name,type:'article',account:expected,httpStatus:response.status()};
    finishCollectionIntent(root,expected,id,'created',receipt);return {status:'created',requestId:id,...receipt,verified:'response_and_list_readback'};
   }catch(error){try{finishCollectionIntent(root,expected,id,'unknown');}catch{};return {status:'unknown',requestId:id,error:error instanceof Error&&/^wechat_[a-z_]+$/.test(error.message)?error.message:'wechat_collection_result_unknown',note:'Check the original request and WeChat collection list. Never resubmit an unknown request.'};}
  }finally{await editor.close().catch(()=>{});}
 });
}


/** Accept a collection update only if it preserves every existing item and adds the exact requested article. */
export function validateCollectionAddPayload(body:string,collectionId:string,expectedIds:string[]){
 const form=new URLSearchParams(body);
 if(form.get('id')!==collectionId)throw Error('wechat_collection_payload_mismatch');
 let keys:unknown;try{keys=JSON.parse(form.get('appmsg_info')||'').appmsgkeys}catch{throw Error('wechat_collection_payload_mismatch')}
 if(!Array.isArray(keys))throw Error('wechat_collection_payload_mismatch');
 const ids=keys.map(x=>String(x?.msgid||'')+'_'+String(x?.itemidx||''));
 if(ids.length!==expectedIds.length||ids.some((x,i)=>x!==expectedIds[i]))throw Error('wechat_collection_payload_mismatch');
}


export async function addWechatCollectionItem(input:Record<string,unknown>){
 if(input.confirmAdd!==true)throw Error('wechat_collection_confirmation_required');
 const expected=account(input.expectedAccount),requestId=String(input.requestId||''),collectionId=String(input.collectionId||''),contentId=String(input.contentId||'');
 if(!/^[0-9]{1,30}$/.test(collectionId)||!/^\d{1,30}_\d{1,4}$/.test(contentId))throw Error('wechat_collection_invalid_id');
 const old=readCollectionIntent(collectionLedgerRoot(),expected,requestId);
 if(old)return {reused:true,...reserveCollectionIntent(collectionLedgerRoot(),expected,requestId,{operation:'add',collectionId,contentId})};
 return startCollectionBatch({...input,contentIds:[contentId],dryRun:false});
}
