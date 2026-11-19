import {collectionSearchOptions,filterCollectionCandidates,collectionTimeBoundary} from './collection-search';
import {chromium,type Browser,type Page} from 'playwright';
import {acquireManagedBrowserActivity} from '../workflow/browser-activity';
type Vue={ $data:Record<string,unknown>;pageChange?:(arg:{currentPage:number})=>void;search?:(query:string)=>void;getSaveData?:()=>Record<string,unknown> };
export function collectionAccount(value:unknown):string{if(typeof value!=='string'||!/^gh_[A-Za-z0-9]{12}$/.test(value))throw Error('wechat_collection_original_account_id_required');return value}
export async function withCollections<T>(expected:string,run:(page:Page)=>Promise<T>):Promise<T>{
 const release=await acquireManagedBrowserActivity('http://127.0.0.1:9222',undefined,12);let browser:Browser|undefined,page:Page|undefined;
 try{browser=await chromium.connectOverCDP('http://127.0.0.1:9222',{timeout:15000});const context=browser.contexts()[0];if(!context)throw Error('wechat_collection_browser_missing');page=await context.newPage();
 await page.goto('https://mp.weixin.qq.com/',{waitUntil:'domcontentloaded',timeout:30000});
 await page.waitForFunction(()=>!!(window as unknown as {wx?:{data?:{user_name?:string}}}).wx?.data?.user_name,null,{timeout:30000});
 if(await page.evaluate(()=>(window as unknown as {wx?:{data?:{user_name?:string}}}).wx?.data?.user_name)!==expected)throw Error('wechat_web_account_mismatch');
 await page.evaluate(()=>{const a=Array.from(document.querySelectorAll('a')).find(x=>x.href.includes('/cgi-bin/appmsgalbummgr'));if(!a)throw Error('collection_menu_missing');location.assign(a.href)});
 await page.waitForURL('**/cgi-bin/appmsgalbummgr**',{timeout:30000});
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('div')).some(e=>{const d=(e as unknown as {__vue__?:{$data?:Record<string,unknown>}}).__vue__?.$data;return d&&Array.isArray(d.totalList)&&typeof d.totalAll==='number'}),null,{timeout:30000});
 return await run(page);
 }finally{await page?.close().catch(()=>{});await browser?.close().catch(()=>{});await release()}
}
export async function openCollectionEditor(page:Page,id:string){
 if(!/^[0-9]{1,30}$/.test(id))throw Error('wechat_collection_invalid_id');
 const info=await page.evaluate(wanted=>{for(const e of document.querySelectorAll('div')){const d=(e as unknown as {__vue__?:Vue}).__vue__?.$data;if(d&&Array.isArray(d.totalList)&&typeof d.totalAll==='number'){const rows=d.totalList as Record<string,unknown>[],matches=rows.filter(x=>String(x.id)===wanted);return {complete:rows.length>=d.totalAll,title:matches.length===1?String(matches[0].title||''):''}}}throw Error('wechat_collection_list_unavailable')},id);
 if(!info.title)throw Error(info.complete?'wechat_collection_not_found':'wechat_collection_list_incomplete');
 const cells=page.locator('td.album-title:visible').filter({hasText:info.title});await cells.first().waitFor({state:'visible',timeout:20000});
 const row=page.locator('tr:visible').filter({has:cells});if(await row.count()!==1)throw Error('wechat_collection_row_ambiguous');
 const [editor]=await Promise.all([page.context().waitForEvent('page',{timeout:15000}),row.getByText('编辑',{exact:true}).click({timeout:15000})]);
 try{await editor.setViewportSize({width:1440,height:1000});await editor.getByPlaceholder('填写名称').waitFor({timeout:30000});
 await editor.waitForFunction(wanted=>Array.from(document.querySelectorAll('div')).some(e=>{const d=(e as unknown as {__vue__?:Vue}).__vue__?.$data;return d&&String(d.albumId)===wanted&&Array.isArray(d.albumList)&&d.showLoading===false}),id,{timeout:45000});
 return editor;
 }catch(error){await editor.close().catch(()=>{});throw error}
}
export async function collectionEditorState(editor:Page){
 return editor.evaluate(()=>{for(const e of document.querySelectorAll('div')){const v=(e as unknown as {__vue__?:Vue}).__vue__,d=v?.$data;if(d&&d.albumId!==undefined&&Array.isArray(d.albumList)){
 const items=(d.albumList as Record<string,unknown>[]).map(x=>({contentId:String(x.aid||''),title:String(x.title||'')})),total=Number(d.oriTotal);
 return {id:String(d.albumId),type:Number(d.albumType),title:String((d.formInfo as Record<string,unknown>)?.title||''),items,total,complete:d.showLoading===false&&Number.isFinite(total)&&items.length>=total,revision:String(d.updateTime),saveData:v?.getSaveData?.()||null};
 }}throw Error('wechat_collection_editor_unavailable')});
}
export async function openCandidateDialog(editor:Page){await editor.getByRole('button',{name:'添加已有内容',exact:true}).click();await waitCandidatePage(editor)}
export async function waitCandidatePage(editor:Page,wanted?:number){
 await editor.waitForFunction(p=>{const v=(document.querySelector('.publish_dialog') as unknown as {__vue__?:Vue})?.__vue__,d=v?.$data;return d&&Array.isArray(d.currentList)&&d.loading===false&&(p===undefined||Number(d.lastPage)===p)},wanted,{timeout:30000});
}
export async function candidatePage(editor:Page,wanted=1,query=''){
 if(!Number.isInteger(wanted)||wanted<1||wanted>1000)throw Error('wechat_collection_page_invalid');
 if(query){
  const currentQuery=await editor.evaluate(()=>(document.querySelector('.publish_dialog') as unknown as {__vue__?:Vue})?.__vue__?.$data?.query);
  if(currentQuery!==query){await editor.evaluate(value=>{const v=(document.querySelector('.publish_dialog') as unknown as {__vue__?:Vue})?.__vue__;if(!v?.search)throw Error('wechat_collection_search_unavailable');v.search(value)},query);await waitCandidatePage(editor,1)}
 }
 const current=await editor.evaluate(()=>(document.querySelector('.publish_dialog') as unknown as {__vue__?:Vue})?.__vue__?.$data?.lastPage);
 if(Number(current)!==wanted){await editor.evaluate(p=>{const v=(document.querySelector('.publish_dialog') as unknown as {__vue__?:Vue})?.__vue__;if(!v?.pageChange)throw Error('wechat_collection_pagination_unavailable');v.pageChange({currentPage:p})},wanted);await waitCandidatePage(editor,wanted)}
 const value=await editor.evaluate(()=>{const v=(document.querySelector('.publish_dialog') as unknown as {__vue__?:Vue})?.__vue__,d=v?.$data;if(!d||!Array.isArray(d.currentList))throw Error('wechat_collection_candidates_unavailable');
 const rows=d.currentList as Record<string,unknown>[],page=Number(d.lastPage),size=Number(d.count),total=Number(d.totalCount),boxes=Array.from(document.querySelectorAll('.publish_dialog .appmsg-list-publish input[type=checkbox]')) as HTMLInputElement[];
 const groups=rows.map((r,index)=>{const articles=Array.isArray(r.appmsgex)?r.appmsgex as Record<string,unknown>[]:[];return {index,selectable:r.canselect!==false&&boxes.length===rows.length&&!boxes[index]?.disabled,articles:articles.map(a=>{
 const infos=Array.isArray(a.appmsg_album_infos)?a.appmsg_album_infos as Record<string,unknown>[]:null;
 const collectionIds=Array.from(new Set([...(typeof a.album_id==='string'&&a.album_id!=='0'&&/^\d+$/.test(a.album_id)?[a.album_id]:[]),...(infos||[]).flatMap(x=>typeof x.id==='string'&&/^\d+$/.test(x.id)&&x.id!=='0'?[x.id]:[])]));
 const stamp=Number(r.update_time),publicationTime=Number.isFinite(stamp)&&stamp>0&&stamp<4102444800?new Date(stamp*1000).toISOString():null;
 return {contentId:String(a.aid||''),articleId:String(a.appmsgid||''),itemIndex:Number(a.itemidx||0),title:String(a.title||'').replace(/<\/?em(?:\s[^>]*)?>/gi,''),publicationTime,timeSource:'wechat_publication_group.update_time',collectionIds,assignmentKnown:infos!==null,hasCollection:!!infos?.length||collectionIds.length>0};
})}});
 return {page,pageSize:size,total,groupCount:groups.length,groups};
 });
 if(value.page!==wanted||!Number.isInteger(value.total)||value.total<0||!Number.isInteger(value.pageSize)||value.pageSize<1)throw Error('wechat_collection_pagination_unverified');
 const hasMore=value.page*value.pageSize<value.total;
 return {...value,hasMore,nextPage:hasMore?value.page+1:null,complete:value.page===1&&!hasMore,totalUnit:'publication_groups'};
}
export async function readCollectionCandidates(input:Record<string,unknown>){
 const account=collectionAccount(input.expectedAccount),id=String(input.collectionId||''),page=input.page===undefined?1:Number(input.page),options=collectionSearchOptions(input);
 return withCollections(account,async root=>{const editor=await openCollectionEditor(root,id);try{const state=await collectionEditorState(editor);if(state.id!==id||state.type!==0)throw Error('wechat_collection_article_type_required');await openCandidateDialog(editor);const value=await candidatePage(editor,page,options.query);
 const flattened=value.groups.flatMap(g=>g.articles.map(a=>({...a,groupSize:g.articles.length,selectionSupported:g.selectable&&g.articles.length===1}))),filtered=filterCollectionCandidates(flattened,options);
 const times=value.groups.map(g=>g.articles[0]?.publicationTime||null);
 const windowExhausted=collectionTimeBoundary(times,options.since),hasMore=value.hasMore&&!windowExhausted,nextPage=hasMore?value.page+1:null;
 return {account,collectionId:id,collectionTitle:state.title,page:value.page,pageSize:value.pageSize,total:value.total,totalUnit:value.totalUnit,totalBeforeLocalFilters:true,upstreamHasMore:value.hasMore,hasMore,nextPage,complete:value.complete,windowExhausted,filters:options,nextArguments:hasMore?{expectedAccount:account,collectionId:id,page:nextPage,query:options.query,unassignedOnly:options.unassignedOnly,...options.since?{since:options.since}:{recentDays:0}}:null,checkedAt:new Date().toISOString(),items:filtered.items,unknownTimeCount:filtered.unknownTimeCount,unknownAssignmentCount:filtered.unknownAssignmentCount,note:'Native keyword search plus one-page local filtering; default rolling 7 days and unassigned-only. Follow nextArguments unchanged. Stop at an older descending page; complete refers to full native history. Unknown metadata is excluded, never assumed unassigned. No collection changes.'};
 }finally{await editor.close().catch(()=>{})}});
}
export async function listCollectionItems(input:Record<string,unknown>){
 const account=collectionAccount(input.expectedAccount),id=String(input.collectionId||'');
 return withCollections(account,async root=>{const editor=await openCollectionEditor(root,id);try{const s=await collectionEditorState(editor);if(s.id!==id||!s.complete)throw Error('wechat_collection_members_incomplete');return {account,collectionId:id,title:s.title,type:s.type,items:s.items,total:s.items.length,complete:s.complete,revision:s.revision}}finally{await editor.close().catch(()=>{})}});
}
