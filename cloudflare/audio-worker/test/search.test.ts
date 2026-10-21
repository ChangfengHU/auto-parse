import test from 'node:test';
import assert from 'node:assert/strict';
import { searchAudioSources, matchesSourceFilters, wikimediaAsset, type SourceQuery } from '../../../lib/audio-source-search';
import { inputs } from '../src/schema';
import { errorResponse } from '../src/core';

const query: SourceQuery = {provider:'wikimedia',q:'雨声',kind:'sound_effect',page:1};
function page(title='rain',duration=12,license='CC0') {
  return {title:`File:${title}.ogg`,index:1,imageinfo:[{mime:'audio/ogg',duration,url:'https://upload.wikimedia.org/rain.ogg',descriptionurl:'https://commons.wikimedia.org/wiki/File:rain.ogg',extmetadata:{Artist:{value:'<b>Artist</b>'},LicenseShortName:{value:license}}}]};
}
test('MCP defaults to available source and exposes duration/license/page filters',()=>{
  const p=inputs.search.parse({q:'rain',kind:'sound_effect'});
  assert.equal(p.provider,'wikimedia'); assert.equal(p.pageSize,12); assert.equal(p.license,'commercial');
});
test('Openverse suspended fast without any network request',async()=>{
  let calls=0;
  await assert.rejects(searchAudioSources({...query,provider:'openverse'},async()=>{calls++;return new Response()}),/暂时停用/);
  assert.equal(calls,0);
});
test('Chinese aliases, duration normalization, source provenance and continuation',async()=>{
  const r=await searchAudioSources(query,async url=>{
    assert.equal(new URL(String(url)).searchParams.get('gsrsearch'),'rain filetype:audio');
    return Response.json({query:{pages:[page()]},continue:{gsroffset:12}});
  });
  assert.equal(r.items[0].durationMs,12000);assert.equal(r.items[0].creator,'Artist');
  assert.equal(r.items[0].provider,'wikimedia');assert.equal(r.hasNext,true);assert.equal(r.totalExact,false);
});
test('empty results are a successful empty page, not upstream failure',async()=>{
  const r=await searchAudioSources(query,async()=>Response.json({batchcomplete:true}));
  assert.deepEqual(r.items,[]);assert.equal(r.hasNext,false);
});
test('filter boundaries, unknown duration, and authorization are not silently ignored',()=>{
  const a=wikimediaAsset(page(), 'sound_effect')!;
  for(const [length,ms,expected] of [['shortest',29999,true],['shortest',30000,false],['short',30000,true],['short',240000,false],['medium',240000,true],['medium',600000,false],['long',600000,true]] as const)
    assert.equal(matchesSourceFilters({...a,durationMs:ms},{...query,length}),expected);
  assert.equal(matchesSourceFilters({...a,durationMs:null},{...query,length:'short'}),false);
  assert.equal(matchesSourceFilters({...a,license:'CC BY 4.0'},{...query,license:'cc0'}),false);
  assert.equal(matchesSourceFilters({...a,license:'unknown'},query),false);
  assert.equal(wikimediaAsset(page('rain',12,'CC BY-NC 4.0'),'sound_effect'),null);
});
test('invalid parameters are rejected before upstream I/O',async()=>{
  for(const q of [{...query,page:0},{...query,page:21},{...query,pageSize:100},{...query,kind:'bad'},{...query,license:'bad'},{...query,length:'bad'}])
    await assert.rejects(searchAudioSources(q,async()=>{throw Error('must not fetch')}),/参数不合法/);
});
test('HTML gateway failure, malformed JSON and API errors become safe JSON errors',async()=>{
  for(const response of [new Response('<html>Bad gateway</html>',{status:502}),new Response('<html>not JSON</html>'),Response.json({error:{info:'internal'}}),Response.json({query:{pages:'wrong'}})]) {
    try {await searchAudioSources(query,async()=>response);assert.fail('must reject')} catch(e) {
      const r=errorResponse(e);assert.equal(r.status,502);assert.ok(r.headers.get('content-type')?.includes('json'));assert.ok(!(await r.text()).includes('<html>'));
    }
  }
});
test('metadata is bounded and rate limit remains distinguishable',async()=>{
  await assert.rejects(searchAudioSources(query,async()=>new Response('x'.repeat(2*1024*1024+1))),/响应过大/);
  try {await searchAudioSources(query,async()=>new Response('',{status:429}));assert.fail()}catch(e){assert.equal(errorResponse(e).status,429)}
});
