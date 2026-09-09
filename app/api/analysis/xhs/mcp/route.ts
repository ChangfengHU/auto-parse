import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { getXhsCookie, setXhsCookie } from '@/lib/analysis/xhs-cookie';
import { getXhsUnread, searchXhsNotes, getXhsFeed } from '@/lib/analysis/xhs-backend';
import { getPlatformSessionCookie, upsertPlatformSession } from '@/lib/analysis/platform-session';
import { classifyXhsFailure } from '@/lib/analysis/xhs-mcp-errors';
export const runtime = 'nodejs';
let refreshing = false;
function fail(code: string, status = 200) { return NextResponse.json({ok:false, code}, {status}); }
function helper(input: object): Promise<string> {
 return new Promise((resolve,reject)=>{
  const child=spawn('python3',['python/scripts/xhs-session-read.py'],{cwd:process.cwd(),stdio:['pipe','pipe','pipe']});
  let output=''; const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('refresh_timeout'));},45000);
  child.stdout.on('data',b=>{output+=b.toString();if(output.length>131072){child.kill();reject(Error('session_too_large'));}});
  child.stderr.resume(); child.stdin.on('error',()=>{});
  child.once('error',()=>{clearTimeout(timer);reject(Error('runtime_unavailable'));});
  child.once('close',code=>{clearTimeout(timer);if(code===0)resolve(output);else reject(Error('source_unavailable'));});
  child.stdin.end(JSON.stringify(input));
 });
}
export async function POST(req: Request) {
 let phase='request';
 let config: {token:string;allowed_hosts:string[]};
 try {config=JSON.parse(await readFile('.runtime/xhs-mcp/config.json','utf8'));} catch {return fail('service_not_configured',503);}
 const given=Buffer.from((req.headers.get('authorization')||'').replace(/^Bearer /,'')); const expected=Buffer.from(config.token);
 if(given.length!==expected.length||!timingSafeEqual(given,expected))return fail('unauthorized',401);
 try {
  const body=await req.json();
  if(body.action==='refresh'){
   if(!config.allowed_hosts.includes(body.host)||!Number.isInteger(body.instance)||body.instance<1||body.instance>32||typeof body.privateKey!=='string')return fail('unsupported_source',400);
   if(refreshing)return fail('refresh_busy',409);
   refreshing=true;
   try {
    phase='source_read'; const cookie=await helper({host:body.host,instance:body.instance,privateKey:body.privateKey});
    if(!cookie.trim())return fail('source_unavailable');
    // Validate candidate BEFORE replacing the currently selected credential.
    phase='candidate_validation'; await getXhsUnread(cookie.trim());
    phase='credential_persistence'; const clientId='xhs_'+randomUUID();
    await upsertPlatformSession('xhs',clientId,cookie.trim());
    if(await getPlatformSessionCookie('xhs',clientId)!==cookie.trim())return fail('credential_persistence_failed');
    setXhsCookie(cookie.trim());
    return NextResponse.json({ok:true,valid:true,credential_id:clientId,source:{host:body.host,instance:body.instance}});
   }finally{refreshing=false;}
  }
  if(body.action==='runtime_check'){
   // Import in the same environment selected by the CLI bridge.
   const {execFile}=await import('node:child_process'); const {promisify}=await import('node:util');
   const {getXhsCliBridgeConfig}=await import('@/lib/analysis/xhs-cli-bridge');
   const c=getXhsCliBridgeConfig();
   await promisify(execFile)(c.python,['-c','import httpx, xhshow, xhs_cli.cli'],{cwd:c.root,timeout:15000});
   return NextResponse.json({ok:true,runtime_ready:true});
  }
  const cookie=getXhsCookie();if(!cookie)return fail('login_missing');
  if(body.action==='login_status'){await getXhsUnread(cookie);return NextResponse.json({ok:true,valid:true});}
  if(body.action==='search'){
   if(typeof body.keyword!=='string'||!body.keyword.trim()||body.keyword.length>100)return fail('invalid_input',400);
   const page=body.page??1;if(!Number.isInteger(page)||page<1||page>5)return fail('invalid_input',400);
   return NextResponse.json({ok:true,data:await searchXhsNotes(cookie,body.keyword,page)});
  }
  if(body.action==='recommendations')return NextResponse.json({ok:true,data:await getXhsFeed(cookie),global_hot_ranking:false});
  return fail('unknown_action',400);
 }catch(error){return NextResponse.json({ok:false,code:classifyXhsFailure(error instanceof Error?error.message:String(error)),phase});}
}
