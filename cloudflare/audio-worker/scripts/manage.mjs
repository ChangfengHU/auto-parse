// Credentials arrive over an echo-disabled stdin pipe; never argv, files or logs.
import {createInterface} from 'node:readline';
import {spawn} from 'node:child_process';
const rl=createInterface({input:process.stdin});
const [line]=await new Promise(resolve=>rl.once('line',line=>{rl.close();resolve([line]);}));
const input=JSON.parse(line);const mode=process.argv[2];
const config=input.cloudflare;
const headers=config.apiToken?{Authorization:`Bearer ${config.apiToken}`}:{'X-Auth-Email':config.email,'X-Auth-Key':config.globalKey};
const check=await fetch(`https://api.cloudflare.com/client/v4/accounts/${config.accountId}`,{headers});
const identity=await check.json();
if(!identity.success||identity.result.id!=='059feb047348e153b65f5efde638acf4')throw new Error('CF account verification failed');
console.log(JSON.stringify({accountVerified:true,mode}));
const env={...process.env,CLOUDFLARE_ACCOUNT_ID:config.accountId,WRANGLER_SEND_METRICS:'false'};
if(config.apiToken)env.CLOUDFLARE_API_TOKEN=config.apiToken;
else{env.CLOUDFLARE_EMAIL=config.email;env.CLOUDFLARE_API_KEY=config.globalKey;}
const commands={migrate:['d1','migrations','apply','auto-parse-audio','--remote'],deploy:['deploy'],secret:['secret','put','AUDIO_ACCESS_TOKEN']};
if(!commands[mode])throw new Error('unknown mode');
const child=spawn('./node_modules/.bin/wrangler',commands[mode],{env,stdio:['pipe','inherit','inherit']});
child.stdin.end(mode==='secret'?`${input.accessToken}\n`:'y\n');
await new Promise((resolve,reject)=>{child.on('exit',code=>code===0?resolve():reject(new Error(`wrangler failed: ${code}`)));child.on('error',reject);});
