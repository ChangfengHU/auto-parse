import {chromium} from 'playwright';
import {acquireManagedBrowserActivity} from './browser-activity';
import {parseCreationBody} from './douyin-publication-ledger';

export async function getDouyinVideoPublication(accountId: string, awemeId: string) {
  if(!/^\d{5,30}$/.test(accountId)||!/^\d{10,30}$/.test(awemeId))throw Error('publication_input_invalid');
  const release=await acquireManagedBrowserActivity('http://127.0.0.1:9223','/run/linux-browser-vnc',12);
  let browser;
  let page;
  try {
    browser=await chromium.connectOverCDP('http://127.0.0.1:9223');
    page=await browser.contexts()[0].newPage();
    const response=page.waitForResponse(r=>new URL(r.url()).origin==='https://creator.douyin.com'&&new URL(r.url()).pathname==='/janus/douyin/creator/pc/work_list'&&r.request().method()==='GET',{timeout:45000})
      .then(async r=>r.ok()?parseCreationBody(await r.text()):null).catch(()=>null);
    await page.goto('https://creator.douyin.com/creator-micro/content/manage',{waitUntil:'domcontentloaded',timeout:30000});
    const uid=await page.evaluate(async()=>{
      const r=await fetch('/web/api/media/user/info/',{credentials:'include',signal:AbortSignal.timeout(10000)});const j=await r.json();
      return r.ok&&j.status_code===0?String(j.user?.uid||''):'';
    });
    if(uid!==accountId)throw Error('creator_account_mismatch');
    const body=await response;
    if(!body||body.status_code!==0||!Array.isArray(body.aweme_list))throw Error('publication_readback_unavailable');
    const items=body.aweme_list as Array<Record<string,unknown>>;
    const matches=items.filter(x=>String(x.aweme_id)===awemeId);
    if(matches.length>1)throw Error('publication_readback_ambiguous');
    const item=matches[0];
    if(!item)return {found:false,accountId,awemeId,observedItems:items.length,complete:false,source:'creator_recent_work_list',note:'Not found in this observed recent page. This does not prove absence or authorize resubmission.'};
    const author=item.author as Record<string,unknown>|undefined;
    if(author?.uid!==undefined&&String(author.uid)!==accountId)throw Error('creator_account_mismatch');
    const video=(item.video||{}) as Record<string,unknown>;
    const cover=(video.cover||{}) as Record<string,unknown>;
    const status=(item.status||{}) as Record<string,unknown>;
    const control=(item.video_control||{}) as Record<string,unknown>;
    const mix=(item.mix_info||{}) as Record<string,unknown>;
    const allowedStatus=['is_private','is_friend_only','is_delete','is_prohibited','reviewed','self_see','in_reviewing','private_status'];
    const observedStatus=Object.fromEntries(allowedStatus.filter(k=>status[k]!==undefined).map(k=>[k,status[k]]));
    return {found:true,accountId,awemeId,url:'https://www.douyin.com/video/'+awemeId,description:item.desc??null,
      createTime:item.create_time??null,durationMs:video.duration??item.duration??null,
      cover:{uri:cover.uri??null,width:cover.width??null,height:cover.height??null,url:Array.isArray(cover.url_list)?cover.url_list[0]??null:null},
      status:observedStatus,visibility:status.private_status==null?null:({0:'public',1:'private',2:'friends'} as Record<number,string>)[Number(status.private_status)]??null,downloadPermission:control.allow_download??item.allow_download??null,
      collection:mix.mix_id?{id:String(mix.mix_id),name:mix.mix_name??null}:null,
      scheduledTime:item.schedule_time??item.publish_time??null,verifiedAt:new Date().toISOString(),
      source:'creator_recent_work_list',publicVisibilityVerified:false,
      note:'Creator readback is distinct from anonymous public visibility; null fields were not exposed by this native response.'};
  } finally {await page?.close().catch(()=>{});await browser?.close().catch(()=>{});await release();}
}
