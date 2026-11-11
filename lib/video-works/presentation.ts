import type {VideoWork,VideoDelivery} from './store';
export const WORK_CHANNELS=[
 {id:'douyin',name:'抖音',short:'抖',capability:'可准备发布页',connected:true},
 {id:'wechat',name:'公众号',short:'微',capability:'可保存视频草稿',connected:true},
 {id:'xiaohongshu',name:'小红书',short:'红',capability:'转投暂未接入',connected:false},
 {id:'x',name:'X',short:'X',capability:'视频暂未接入',connected:false},
 {id:'instagram',name:'Instagram',short:'IG',capability:'暂未接入',connected:false},
 {id:'threads',name:'Threads',short:'@',capability:'暂未接入',connected:false},
 {id:'facebook',name:'Facebook',short:'f',capability:'暂未接入',connected:false},
 {id:'tiktok',name:'TikTok',short:'Tk',capability:'暂未接入',connected:false},
 {id:'channels',name:'视频号',short:'视',capability:'暂未接入',connected:false}
] as const;
export type WorkChannel=typeof WORK_CHANNELS[number]['id'];
export type ChannelCopy={title:string;description:string;topics:string[];cover?:{verticalUrl?:string;horizontalUrl?:string}};
export type ChannelContent=ChannelCopy&{id:string;platform:WorkChannel;accountId:string;revision:number;updatedAt:string};
export type WorkView=VideoWork&{channelContents?:ChannelContent[]};
export const WORK_STATES:Record<string,string>={registered:'独立入库',content_ready:'文案已备好',reserved:'待处理',running:'处理中',prepared:'发布页已准备',draft_saved:'草稿已保存',published:'已取得发布回执',failed:'失败',unknown:'结果待核实'};
export function channelName(id:string){return WORK_CHANNELS.find(c=>c.id===id)?.name||id}
export function channelDeliveries(w:WorkView,p:string){return w.deliveries.filter(d=>d.input.platform===p).sort((a,b)=>Date.parse(b.sourceCreatedAt||b.createdAt)-Date.parse(a.sourceCreatedAt||a.createdAt))}
export function channelSummary(w:WorkView,p:string){
 const ds=channelDeliveries(w,p),counts:Record<string,number>={};for(const d of ds)counts[d.state]=(counts[d.state]||0)+1;
 const saved=(w.channelContents||[]).filter(c=>c.platform===p);
 const fragments=[['published','回执'],['draft_saved','草稿'],['unknown','待核实'],['failed','失败'],['running','处理中'],['prepared','已准备'],['reserved','待处理']].filter(([s])=>counts[s]).map(([s,label])=>label+' '+counts[s]);
 return {records:ds,counts,saved,accounts:new Set(ds.map(d=>d.input.accountId)).size,label:fragments.join(' · ')||(saved.length?'文案已备好':'无记录'),tone:counts.unknown?'warning':counts.failed?'danger':counts.running?'info':counts.published?'success':counts.draft_saved?'info':'neutral'};
}
export function mostRecentDelivery(ds:VideoDelivery[]){return [...ds].sort((a,b)=>Date.parse(b.sourceCreatedAt||b.createdAt)-Date.parse(a.sourceCreatedAt||a.createdAt))[0]}
export function retainedLabel(w:WorkView){return w.archive?'原片已保留 · '+(w.archive.bytes/1048576).toFixed(1)+' MB':['queued','running'].includes(w.retentionState||'')?'原片留存中':'原片待备份'}
