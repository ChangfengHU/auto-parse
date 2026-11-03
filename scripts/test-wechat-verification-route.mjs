import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),ts=require('typescript');
function setup(page){const module={exports:{}},source=fs.readFileSync(new URL('../app/api/publish/wechat-verification/route.ts',import.meta.url),'utf8'),code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{module,exports:module.exports,require:n=>n.includes('web-verification-link')?{resolveWechatVerificationGrant:t=>t==='valid'?{_page:page}:undefined}:require(n),Response,Request,Uint8Array});return module.exports}
test('QR link page is no-cache and never renders a token in the HTML',async()=>{const x=setup(null),r=await x.GET();assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/);assert.match(await r.text(),/location.hash/);});
test('QR POST serves only the current visible verified WeChat QR',async()=>{let visible=true;
 const page={url:()=> 'https://mp.weixin.qq.com/cgi-bin/appmsg',getByText:()=>({isVisible:async()=>visible}),locator:()=>({count:async()=>1,screenshot:async()=>Buffer.from([1,2,3])})};const x=setup(page);
 const req=t=>new Request('https://example.test/',{method:'POST',body:JSON.stringify({grant:t})});
 let r=await x.POST(req('valid'));assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'image/png');
 visible=false;r=await x.POST(req('valid'));assert.equal(r.status,409);r=await x.POST(req('wrong'));assert.equal(r.status,410);
});
