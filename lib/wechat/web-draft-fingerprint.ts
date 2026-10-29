import {createHash} from 'node:crypto';
function canonical(value:unknown):unknown {
 if(Array.isArray(value))return value.map(canonical);
 if(value && typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical((value as Record<string,unknown>)[key])]));
 return value;
}
export function webDraftFingerprint(articles:unknown):string {
 if(!Array.isArray(articles)||articles.length!==1||!articles[0]||typeof articles[0]!=='object')throw Error('wechat_web_single_newspic_required');
 // Official draft.url is a signed preview link regenerated on each read, not article content.
 // Exclude only this documented response metadata field; retain all nested URLs and ordered image data.
 const stable=articles.map(article=>Object.fromEntries(Object.entries(article).filter(([key])=>key!=='url')));
 return createHash('sha256').update(JSON.stringify(canonical(stable))).digest('hex');
}
