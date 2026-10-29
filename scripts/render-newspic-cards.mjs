
// Deterministic static card export; no animation, user profile, network fonts or external scripts.
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
const [input,output]=process.argv.slice(2);
if(!input||!output)throw Error('Usage: node scripts/render-newspic-cards.mjs input.json output-directory');
const data=JSON.parse(await fs.readFile(input,'utf8'));
if(!Array.isArray(data.cards)||data.cards.length<1||data.cards.length>20)throw Error('Expected 1-20 cards');
await fs.mkdir(output,{recursive:true,mode:0o700});
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const style=`
*{box-sizing:border-box}html,body{margin:0;width:1080px;font-family:"WenQuanYi Zen Hei","Droid Sans Fallback",sans-serif}
.card{width:1080px;height:1440px;padding:82px 80px;background:#faf8fc;color:#211c30;position:relative;overflow:hidden}
.top{display:flex;justify-content:space-between;font-size:26px;letter-spacing:2px;color:#796987}
.rule{height:3px;background:#c8b5eb;margin:34px 0 58px}.eyebrow{font-size:29px;color:#8053be;letter-spacing:5px}
h1{font-size:71px;line-height:1.3;letter-spacing:1px;margin:30px 0 30px;white-space:pre-line;font-weight:700}
.subtitle{font-size:34px;line-height:1.65;color:#6a5c78;margin:0 0 36px}
.points{margin-top:34px}.point{border-top:1px solid #dcd2e5;padding:28px 0 26px;font-size:36px;line-height:1.62}
.point b{font-size:27px;color:#906db6;display:block;letter-spacing:2px;margin-bottom:10px}
.source{font-size:24px;line-height:1.65;color:#80738c;margin-top:30px;word-break:break-all}
.footer{position:absolute;bottom:70px;left:80px;right:80px;display:flex;justify-content:space-between;font-size:25px;color:#85718e;border-top:1px solid #c8b5db;padding-top:24px}
.cover{background:#281a3b;color:#fff}.cover .top,.cover .source,.cover .footer{color:#c9b2e7}.cover .eyebrow{color:#cfb0f6}
.cover h1{font-size:112px;line-height:1.18;margin-top:32px;margin-bottom:28px}.cover .subtitle{color:#dac9ed;font-size:36px;margin-bottom:20px}
.cover .point{font-size:32px;padding:18px 0;border-color:#5a436c}.cover .point b{color:#c4a0ec}.ending{background:#eee4f9}.ending .point{font-size:32px;padding:20px 0}.ending .source{font-size:22px}
`;
const browser=await chromium.launch({headless:true,executablePath:process.env.CARD_CHROMIUM||'/snap/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
const page=await browser.newPage({viewport:{width:1080,height:1440},deviceScaleFactor:1});
const manifest=[];
try{
for(let i=0;i<data.cards.length;i++){
 const c=data.cards[i],stem=String(i+1).padStart(2,'0');
 const body=`<article class="card ${c.cover?'cover':''} ${c.ending?'ending':''}">
 <div class="top"><span>${esc(data.brand)}</span><span>${esc(data.date)}</span></div><div class="rule"></div>
 <div class="content"><div class="eyebrow">${esc(c.label)}</div><h1>${esc(c.title)}</h1>
 ${c.subtitle?`<p class="subtitle">${esc(c.subtitle)}</p>`:''}
 <div class="points">${(c.points||[]).map((p,n)=>`<div class="point"><b>0${n+1}</b>${esc(p)}</div>`).join('')}</div>
 <div class="source">${esc(c.source||'')}</div></div>
 <div class="footer"><span>早报摘编 · 待发布审核</span><span>${stem} / ${String(data.cards.length).padStart(2,'0')}</span></div></article>`;
 const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>'+esc(c.title)+'</title><style>'+style+'</style>'+body+'</html>';
 const htmlFile=path.resolve(output,stem+'.html');await fs.writeFile(htmlFile,html);
 await page.setContent(html);await page.evaluate(()=>document.fonts.ready);
 const overflow=await page.evaluate(()=>{const a=document.querySelector('.content').getBoundingClientRect(),f=document.querySelector('.footer').getBoundingClientRect();return a.bottom>f.top-25||document.documentElement.scrollWidth>1080;});
 if(overflow)throw Error('Card '+stem+' overflows');
 const file=path.resolve(output,stem+'.png');await page.screenshot({path:file});
 manifest.push({index:i+1,title:c.title,file,width:1080,height:1440,bytes:(await fs.stat(file)).size});
}
await fs.writeFile(path.join(output,'manifest.json'),JSON.stringify({source:data.source,date:data.date,cards:manifest},null,2));
const thumbnails=await Promise.all(manifest.map(async c=>'<img src="data:image/png;base64,'+(await fs.readFile(c.file)).toString('base64')+'">'));
const grid='<html><meta charset="utf-8"><style>body{margin:24px;background:#ddd;display:grid;grid-template-columns:repeat(4,270px);gap:16px}img{width:270px;height:360px}</style>'+thumbnails.join('')+'</html>';
await fs.writeFile(path.join(output,'contact.html'),grid);await page.setViewportSize({width:1170,height:800});await page.setContent(grid);
await page.screenshot({path:path.resolve(output,'preview.png'),fullPage:true});
console.log(JSON.stringify({ok:true,cards:manifest.length,output:path.resolve(output),layoutOverflow:false}));
}finally{await browser.close();}
