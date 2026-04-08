import { NextResponse } from 'next/server';
import { getXhsCookie } from '@/lib/analysis/xhs-cookie';
import { getXhsComments } from '@/lib/analysis/xhs-backend';

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
    const cookie = getXhsCookie();
    if (!cookie) {
      return NextResponse.json({ error: '请先设置小红书 Cookie' }, { status: 401 });
    }

    const payload = await getXhsComments(cookie, noteId, { cursor, xsecToken });
    const comments =
      (payload as { comments?: RawComment[]; data?: { comments?: RawComment[] } })?.comments ||
      (payload as { data?: { comments?: RawComment[] } })?.data?.comments ||
      [];
    const nextCursor =
      (payload as { cursor?: string; data?: { cursor?: string } })?.cursor ||
      (payload as { data?: { cursor?: string } })?.data?.cursor ||
      '';
    const hasMoreValue =
      (payload as { has_more?: unknown; hasMore?: unknown; data?: { has_more?: unknown; hasMore?: unknown } })
        ?.has_more ??
      (payload as { has_more?: unknown; hasMore?: unknown; data?: { has_more?: unknown; hasMore?: unknown } })
        ?.hasMore ??
      (payload as { data?: { has_more?: unknown; hasMore?: unknown } })?.data?.has_more ??
      (payload as { data?: { has_more?: unknown; hasMore?: unknown } })?.data?.hasMore;
    return NextResponse.json({
      ok: true,
      data: {
        comments: normalizeComments(comments),
        cursor: nextCursor,
        hasMore: Boolean(hasMoreValue),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('XHS Comments API Error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
