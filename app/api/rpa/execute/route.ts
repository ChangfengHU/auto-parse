function gone(){return Response.json({error:'旧本地 RPA 执行接口已停用，工作流配置仅从 Supabase 读取',replacement:'/api/workflows/tasks'},{status:410});}
export async function POST(){return gone();}
export async function GET(){return gone();}
