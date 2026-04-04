import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { prompt } = await req.json();

    if (!prompt) {
      return NextResponse.json({ error: '必须提供 Prompt' }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: '服务器未配置 GEMINI_API_KEY环境变量' }, { status: 500 });
    }

    const sysPrompt = `你是一个专业的 Meta AI (类似 Midjourney/Sora) 提示词专家。
用户会输入一段简单的中文意图，请你将其扩写为一段适合视频生成模型的高质量【全英文 Prompt】。
要求：
1. 包含核心主体、动作状态、环境背景。
2. 包含镜头词（如 Cinematic, Ultra-detailed, 8k resolution, depth of field, drone shot）。
3. 包含打光与色彩氛围词（如 warm golden hour lighting, neon-lit, glowing）。
4. 只返回这一段英文提示词，不要任何寒暄、解释或 Markdown 引号。`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: `${sysPrompt}\n\n这就是用户的原始输入：\n${prompt}` }],
            },
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 200,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Gemini Enhance Error]', errorText);
      return NextResponse.json({ error: `大模型请求失败: ${response.statusText}` }, { status: 500 });
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    if (!text.trim()) {
      return NextResponse.json({ error: '大模型返回结果为空' }, { status: 500 });
    }

    return NextResponse.json({ success: true, enhanced: text.trim() });

  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    console.error('[Gemini API Exception]', error);
    return NextResponse.json({ error: `扩写服务异常: ${message}` }, { status: 500 });
  }
}
