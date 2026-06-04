function gone(){return Response.json({error:'本地工作流接口已停用，工作流配置仅从 Supabase 读取',replacement:'/api/workflows'},{status:410});}
export async function GET(){return gone();}
export async function POST(){return gone();}
