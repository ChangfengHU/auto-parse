import { NextResponse } from 'next/server';
import { getXhsCookie } from '@/lib/analysis/xhs-cookie';

const PYTHON_API = 'http://127.0.0.1:1030';

type RawComment = {
  id?: string;
  comment_id?: string;
  content?: string;
  like_count?: number | string;
  sub_comment_count?: number | string;
  user_info?: {
    nickname?: string;
    image?: string;
    avatar?: string;
  };
};

function toInt(value: unknown): number {
  return Number.parseInt(String(value ?? '0'), 10) || 0;
}

function normalizeComments(comments: RawComment[] = []) {
  return comments.map((comment) => ({
    id: comment.id || comment.comment_id || '',
    content: comment.content || '',
    likeCount: toInt(comment.like_count),
    subCommentCount: toInt(comment.sub_comment_count),
    nickname: comment.user_info?.nickname || '匿名用户',
    avatar: comment.user_info?.image || comment.user_info?.avatar || '',
  }));
}

export async function POST(req: Request) {
  try {
    const { noteId, cursor = '', xsecToken = '' } = await req.json();
    if (!noteId) {
      return NextResponse.json({ error: 'Note ID is required' }, { status: 400 });
    }

    const params = new URLSearchParams({ note_id: noteId });
    if (cursor) params.set('cursor', cursor);
    if (xsecToken) params.set('xsec_token', xsecToken);

    const res = await fetch(`${PYTHON_API}/comments?${params.toString()}`, {
      method: 'GET',
      headers: {
        'X-XHS-Cookie': getXhsCookie() || '',
      },
    });

    if (!res.ok) {
      throw new Error(`Python API returned ${res.status}`);
    }

    const data = await res.json();
    if (!data?.success) {
      throw new Error(data?.error || '评论接口返回失败');
    }

    const payload = data.data || {};
    return NextResponse.json({
      ok: true,
      data: {
        comments: normalizeComments(payload.comments || []),
        cursor: payload.cursor || '',
        hasMore: Boolean(payload.has_more ?? payload.hasMore),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('XHS Comments API Error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
