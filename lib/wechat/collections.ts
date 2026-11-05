import path from 'node:path';
import {readCollectionIntent,reserveCollectionIntent,finishCollectionIntent} from './collection-ledger';
import {chromium, type Browser, type Page} from 'playwright';
import {acquireManagedBrowserActivity} from '../workflow/browser-activity';

type Collection = {id:string; title:string; type:number; total:number; updatedAt:string};
function account(input:unknown):string {
 if(typeof input!=='string'||!/^gh_[a-zA-Z0-9]{12}$/.test(input))throw Error('wechat_web_invalid_account');
 return input;
}
async function withCollections<T>(expected:string,run:(page:Page)=>Promise<T>):Promise<T>{
 const release=await acquireManagedBrowserActivity('http://127.0.0.1:9222',undefined,12);
 let browser:Browser|undefined; let page:Page|undefined;
 try{
  browser=await chromium.connectOverCDP('http://127.0.0.1:9222',{timeout:15000});
  const context=browser.contexts()[0];if(!context)throw Error('wechat_collection_browser_missing');
  page=await context.newPage();
  await page.goto('https://mp.weixin.qq.com/',{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(()=>!!(window as unknown as {wx?:{data?:{user_name?:string}}}).wx?.data?.user_name,null,{timeout:30000});
  const actual=await page.evaluate(()=>(window as unknown as {wx?:{data?:{user_name?:string}}}).wx?.data?.user_name);
  if(actual!==expected)throw Error('wechat_web_account_mismatch');
  await page.evaluate(()=>{
   const a=Array.from(document.querySelectorAll('a')).find(x=>x.href.includes('/cgi-bin/appmsgalbummgr'));
   if(!a)throw Error('collection_menu_missing');location.assign(a.href);
  });
  await page.waitForURL('**/cgi-bin/appmsgalbummgr**',{timeout:30000});
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('div')).some(e=>{
   const data=(e as unknown as {__vue__?:{$data?:Record<string,unknown>}}).__vue__?.$data;
   return data&&Array.isArray(data.totalList)&&typeof data.totalAll==='number';
  }),null,{timeout:30000});
  return await run(page);
 }finally{
  if(page&&!page.isClosed())await page.close().catch(()=>{});
  if(browser)await browser.close().catch(()=>{});
  await release();
 }
}
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

export async function listWechatCollectionCandidates(input:Record<string,unknown>){
 const expected=account(input.expectedAccount);
 const id=typeof input.collectionId==='string'?input.collectionId:'';
 if(!/^[0-9]{1,30}$/.test(id))throw Error('wechat_collection_invalid_id');
 return withCollections(expected,async page=>{
  const info=await page.evaluate((wanted)=>{
   for(const e of Array.from(document.querySelectorAll('div'))){
    const d=(e as unknown as {__vue__?:{$data?:Record<string,unknown>}}).__vue__?.$data;
    if(!d||!Array.isArray(d.totalList)||typeof d.totalAll!=='number')continue;
    const rows=d.totalList as Array<Record<string,unknown>>;
    const found=rows.filter(a=>String(a.id)===wanted);
    if(found.length!==1)return {found:false,complete:rows.length>=Number(d.totalAll)};
    return {found:true,complete:rows.length>=Number(d.totalAll),title:String(found[0].title||'')};
   }
   throw Error('wechat_collection_list_unavailable');
  },id);
  if(!info.found)throw Error(info.complete?'wechat_collection_not_found':'wechat_collection_list_incomplete');
  const cells=page.locator('td.album-title:visible').filter({hasText:info.title});
  await cells.first().waitFor({state:'visible',timeout:20000});
  const rows=page.locator('tr:visible').filter({has:cells});
  if(await rows.count()!==1)throw Error('wechat_collection_row_ambiguous');
  const context=page.context();
  const [editor]=await Promise.all([context.waitForEvent('page',{timeout:15000}),rows.first().getByText('编辑',{exact:true}).click({timeout:15000})]);
  try{
   await editor.getByPlaceholder('填写名称').waitFor({timeout:30000});
   const verified=await editor.evaluate(()=>{
    for(const el of Array.from(document.querySelectorAll('div'))){
     const d=(el as unknown as {__vue__?:{$data?:Record<string,unknown>}}).__vue__?.$data;
     if(d&&typeof d.albumId!=='undefined'&&Array.isArray(d.albumList))return {id:String(d.albumId),title:String((d.formInfo as Record<string,unknown>)?.title||'')};
    }
    return null;
   });
   if(!verified||verified.id!==id)throw Error('wechat_collection_editor_mismatch');
   await editor.getByRole('button',{name:'添加已有内容'}).click();
   await editor.getByText('只能选择已发表内容，如需添加草稿，请先前往草稿箱发表后添加。',{exact:true}).waitFor({state:'visible',timeout:15000});
   await editor.waitForFunction(()=>{const e=document.querySelector('.publish_dialog');const d=(e as unknown as {__vue__?:{$data?:Record<string,unknown>}})?.__vue__?.$data;return d&&Array.isArray(d.currentList)&&d.loading===false;},null,{timeout:30000});
   const result=await editor.evaluate(()=>{
    const el=document.querySelector('.publish_dialog');
    const d=(el as unknown as {__vue__?:{$data?:Record<string,unknown>}})?.__vue__?.$data;
    if(!d||!Array.isArray(d.currentList))throw Error('wechat_collection_candidates_unavailable');
    const items=(d.currentList as Array<Record<string,unknown>>).flatMap(row=>{
     const infos=Array.isArray(row.appmsgex)?row.appmsgex:[];
     return infos.map(raw=>{const a=raw as Record<string,unknown>;return {contentId:String(a.aid||''),articleId:String(a.appmsgid||''),itemIndex:Number(a.itemidx||0),title:String(a.title||'')};});
    });
    return {items,total:typeof d.totalCount==='number'?d.totalCount:null};
   });
   return {account:expected,collectionId:id,collectionTitle:info.title,...result,complete:result.total!==null&&result.items.length>=result.total,note:'Only already-published content is eligible. This read-only call does not add or publish content.'};
  }finally{await editor.close().catch(()=>{});}
 });
}


const collectionLedgerRoot=()=>path.join(process.cwd(),'.data/wechat-collection-requests');
export function wechatCollectionRequestStatus(input:Record<string,unknown>){
 const expected=account(input.expectedAccount),id=String(input.requestId||'');
 const record=readCollectionIntent(collectionLedgerRoot(),expected,id);
 return record?{found:true,...record,note:'submitting or unknown requires manual reconciliation; never change requestId and resubmit.'}:{found:false,requestId:id};
}
export function validateCollectionReceipt(ret:unknown,before:string[],after:{id:string;title:string}[],name:string,complete:boolean){
 if(!(ret===0||ret==='0')||!complete)throw Error('wechat_collection_result_unknown');
 const added=after.filter(item=>item.title===name&&!before.includes(item.id));
 if(added.length!==1||!/^[0-9]{1,30}$/.test(added[0].id))throw Error('wechat_collection_result_unknown');
 return added[0].id;
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
    const after=await snapshot(),collectionId=validateCollectionReceipt(code,before.items.map(x=>x.id),after.items,name,after.complete);
    const receipt={collectionId,name,type:'article',account:expected,httpStatus:response.status()};
    finishCollectionIntent(root,expected,id,'created',receipt);return {status:'created',requestId:id,...receipt,verified:'response_and_list_readback'};
   }catch(error){try{finishCollectionIntent(root,expected,id,'unknown');}catch{};return {status:'unknown',requestId:id,error:error instanceof Error&&/^wechat_[a-z_]+$/.test(error.message)?error.message:'wechat_collection_result_unknown',note:'Check the original request and WeChat collection list. Never resubmit an unknown request.'};}
  }finally{await editor.close().catch(()=>{});}
 });
}
