/**
 * DEBUG: 查看小红书页面的原始数据
 */

import { NextResponse } from 'next/server';
import { getXhsCookie } from '@/lib/analysis/xhs-cookie';

const BASE_HEADERS: Record<string, string> = {
  accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'accept-language': 'zh-CN,zh;q=0.9',
  referer: 'https://www.xiaohongshu.com/explore',
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};

export async function POST(req: Request) {
  const { url } = await req.json() as { url?: string };
  
  if (!url?.trim()) {
    return NextResponse.json({ error: '请输入链接' }, { status: 400 });
  }

  const cookie = getXhsCookie();
  if (!cookie) {
    return NextResponse.json({ error: '请先设置小红书 Cookie' }, { status: 401 });
  }

  try {
    // 1. 解析短链
    const headers: Record<string, string> = { ...BASE_HEADERS };
    if (cookie) headers['cookie'] = cookie;

    const res = await fetch(url, {
      method: 'HEAD',
      headers,
      redirect: 'follow',
    }).catch(() => null);

    const resolvedUrl = res?.url ?? url;
    console.log('解析后的URL:', resolvedUrl);

    // 2. 获取页面HTML
    const htmlRes = await fetch(resolvedUrl, { headers, redirect: 'follow' });
    if (!htmlRes.ok) {
      return NextResponse.json({ 
        error: `请求失败 HTTP ${htmlRes.status}，Cookie 可能已失效`,
        status: htmlRes.status 
      }, { status: 500 });
    }
    
    const html = await htmlRes.text();
    
    // 3. 提取 __INITIAL_STATE__
    const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/g;
    let initialState = null;
    let foundScript = false;
    
    let m: RegExpExecArray | null;
    while ((m = scriptRe.exec(html)) !== null) {
      const text = m[1].trim();
      if (!text.includes('window.__INITIAL_STATE__')) continue;
      
      foundScript = true;
      try {
        const valueStr = text
          .replace(/^[\s\S]*?window\.__INITIAL_STATE__\s*=\s*/, '')
          .replace(/;\s*$/, '')
          .trim();

        // 简单评估（生产环境应该用更安全的方法）
        initialState = eval(`(${valueStr})`);
        break;
      } catch (e) {
        console.error('解析 __INITIAL_STATE__ 失败:', e);
      }
    }

    // 4. 检查数据结构
    const debug = {
      resolvedUrl,
      htmlLength: html.length,
      foundScript,
      hasInitialState: !!initialState,
      initialStateKeys: initialState ? Object.keys(initialState) : [],
      noteDetailMap: initialState?.noteDetailMap ? Object.keys(initialState.noteDetailMap) : null,
      noteData: initialState?.noteData ? 'exists' : null,
      
      // 新增：检查 note 字段结构
      noteField: initialState?.note ? {
        type: typeof initialState.note,
        keys: Object.keys(initialState.note),
        hasNoteId: !!initialState.note.noteId,
        hasData: !!initialState.note.data,
        hasNoteDetailMap: !!initialState.note.noteDetailMap,
      } : null,
      
      // 尝试提取 noteData
      pcNote: null as any,
      mobileNote: null as any,
      newNote: null as any,
    };

    if (initialState) {
      // 新路径：state.note（优先尝试）
      try {
        if (initialState.note && typeof initialState.note === 'object') {
          if (initialState.note.noteDetailMap) {
            const map = initialState.note.noteDetailMap;
            const key = Object.keys(map)[0];
            const note = map[key]?.note;
            if (note?.noteId) {
              debug.newNote = {
                path: 'note.noteDetailMap',
                noteId: note.noteId,
                title: note.title || 'no title',
                type: note.type || 'no type',
                hasImageList: !!note.imageList,
                hasVideo: !!note.video,
              };
            }
          }
          
          if (!debug.newNote && initialState.note.noteId) {
            debug.newNote = {
              path: 'note',
              noteId: initialState.note.noteId,
              title: initialState.note.title || 'no title',
              type: initialState.note.type || 'no type',
              hasImageList: !!initialState.note.imageList,
              hasVideo: !!initialState.note.video,
            };
          }
          
          if (!debug.newNote && initialState.note.data?.noteId) {
            debug.newNote = {
              path: 'note.data',
              noteId: initialState.note.data.noteId,
              title: initialState.note.data.title || 'no title',
              type: initialState.note.data.type || 'no type',
              hasImageList: !!initialState.note.data.imageList,
              hasVideo: !!initialState.note.data.video,
            };
          }
        }
      } catch (e) {
        debug.newNote = { error: e instanceof Error ? e.message : String(e) };
      }

      // PC 路径：noteDetailMap.{noteId}.note
      try {
        const map = initialState.noteDetailMap;
        if (map && typeof map === 'object') {
          const key = Object.keys(map)[0];
          const note = map[key]?.note;
          if (note?.noteId) {
            debug.pcNote = {
              noteId: note.noteId,
              title: note.title || 'no title',
              type: note.type || 'no type',
              hasImageList: !!note.imageList,
              hasVideo: !!note.video,
            };
          }
        }
      } catch (e) {
        debug.pcNote = { error: e instanceof Error ? e.message : String(e) };
      }

      // 移动端路径：noteData.data.noteData
      try {
        const note = initialState?.noteData?.data?.noteData;
        if (note?.noteId) {
          debug.mobileNote = {
            noteId: note.noteId,
            title: note.title || 'no title',
            type: note.type || 'no type',
            hasImageList: !!note.imageList,
            hasVideo: !!note.video,
          };
        }
      } catch (e) {
        debug.mobileNote = { error: e instanceof Error ? e.message : String(e) };
      }
    }

    return NextResponse.json({ ok: true, debug });
    
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error }, { status: 500 });
  }
}