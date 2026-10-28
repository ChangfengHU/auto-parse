import {handlePlatformMcp,platformMcpGet} from '@/lib/workflow/platform-mcp-route';
export const runtime='nodejs';
export const dynamic='force-dynamic';
type Context={params:Promise<{platform:string}>};
export async function POST(req:Request,ctx:Context){return handlePlatformMcp(req,(await ctx.params).platform);}
export async function GET(req:Request,ctx:Context){return platformMcpGet(req,(await ctx.params).platform);}
