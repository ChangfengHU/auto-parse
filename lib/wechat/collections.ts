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

