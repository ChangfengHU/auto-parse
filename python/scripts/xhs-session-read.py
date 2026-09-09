"""Internal credential transport; stdout consumed only by authenticated server."""
import os,sys,json,subprocess
req=json.load(sys.stdin)
if req.get('host')!='152.32.214.95' or type(req.get('instance')) is not int or not 1<=req['instance']<=32: sys.exit(2)
node=r"""
import {chromium} from '/home/claude/linux-clash-skill/skills/chatgpt-image-service/node_modules/playwright/index.mjs';
import {acquireBrowserActivity} from '/home/claude/linux-clash-skill/skills/linux-browser-vnc/scripts/browser-activity.mjs';
const port=9221+INSTANCE;let browser,unlock;
try {
 unlock=await acquireBrowserActivity(port);if(!unlock)throw Error('busy');
 browser=await chromium.connectOverCDP('http://127.0.0.1:'+port,{timeout:10000});
 const ctx=browser.contexts()[0];if(!ctx)throw Error('context_missing');
 const cookies=(await ctx.cookies('https://www.xiaohongshu.com/')).filter(c=>c.domain.replace(/^\./,'')==='xiaohongshu.com'||c.domain.endsWith('.xiaohongshu.com'));
 if(!cookies.some(c=>c.name==='web_session'&&c.value))throw Error('login_missing');
 process.stdout.write(cookies.map(c=>c.name+'='+c.value).join('; '));
}catch{process.exitCode=1;}finally{
 if(browser)await Promise.race([browser.close().catch(()=>{}),new Promise(r=>setTimeout(r,2000))]);
 if(unlock)unlock();
}
""".replace('INSTANCE',str(req['instance']))
fd=os.memfd_create('xhs-ssh',0);os.fchmod(fd,0o600);os.write(fd,req['privateKey'].encode())
try:
 r=subprocess.run(['ssh','-i','/proc/'+str(os.getpid())+'/fd/'+str(fd),'-o','IdentitiesOnly=yes','-o','BatchMode=yes','-o','ConnectTimeout=10','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile=.runtime/xhs-mcp/known_hosts','claude@'+req['host'],'node --input-type=module -'],input=node,capture_output=True,text=True,pass_fds=(fd,),timeout=30)
 if r.returncode or len(r.stdout)>131072:sys.exit(3)
 sys.stdout.write(r.stdout)
except Exception:sys.exit(4)
finally:os.close(fd)
