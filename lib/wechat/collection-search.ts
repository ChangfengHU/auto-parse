export type CollectionSearch={query:string;unassignedOnly:boolean;since:string|null;recentDays:number};
export function collectionSearchOptions(raw:Record<string,unknown>,now=Date.now()):CollectionSearch{
 const query=raw.query===undefined?'':raw.query;if(typeof query!=='string'||Array.from(query).length>200)throw Error('wechat_collection_query_invalid');
 if(raw.unassignedOnly!==undefined&&typeof raw.unassignedOnly!=='boolean')throw Error('wechat_collection_unassigned_boolean_required');
 const recentDays=raw.recentDays===undefined?7:raw.recentDays;if(typeof recentDays!=='number'||!Number.isInteger(recentDays)||recentDays<0||recentDays>365)throw Error('wechat_collection_recent_days_invalid');
 let since=recentDays?new Date(now-recentDays*86400000).toISOString():null;
 if(raw.since!==undefined){if(typeof raw.since!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(raw.since)||!Number.isFinite(Date.parse(raw.since))||Date.parse(raw.since)>now)throw Error('wechat_collection_since_invalid');since=new Date(raw.since).toISOString()}
 return {query:query.trim(),unassignedOnly:raw.unassignedOnly!==false,since,recentDays};
}
type SearchArticle={contentId:string;title:string;publicationTime:string|null;collectionIds:string[];assignmentKnown:boolean;hasCollection:boolean};
export function filterCollectionCandidates<T extends SearchArticle>(items:T[],options:CollectionSearch){
 const cutoff=options.since?Date.parse(options.since):null;
 return {items:items.filter(a=>(!options.unassignedOnly||a.assignmentKnown&&!a.hasCollection)&&(cutoff===null||a.publicationTime!==null&&Date.parse(a.publicationTime)>=cutoff)),unknownTimeCount:items.filter(a=>a.publicationTime===null).length,unknownAssignmentCount:items.filter(a=>!a.assignmentKnown).length};
}

export function collectionTimeBoundary(times:(string|null)[],since:string|null){
 if(!since||!times.length)return false;
 const stamps=times.map(t=>t?Date.parse(t):NaN);
 return stamps.every((t,i)=>Number.isFinite(t)&&(i===0||t<=stamps[i-1]))&&stamps[stamps.length-1]<Date.parse(since);
}
