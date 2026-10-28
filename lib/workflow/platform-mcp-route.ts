import {validToolArguments} from './mcp-contract';
import {authorizePlatformMcp,isPublicationPlatform,platformMcpTools} from './platform-mcp-contract';
import {callPlatformTool} from './platform-mcp-service';
import { isRecord, redactWorkflowData, WorkflowInputError, WorkflowConflictError } from './validation';

const VERSIONS = ['2025-06-18', '2025-03-26'];
const headers = { 'Cache-Control': 'no-store' };
const rpcError = (id: unknown, code: number, message: string, status = 200) => Response.json({ jsonrpc: '2.0', id, error: { code, message } }, { status, headers });

export async function handlePlatformMcp(req:Request,platform:string) {
  if(!isPublicationPlatform(platform))return Response.json({error:'platform_not_found'},{status:404,headers});
  const WORKFLOW_MCP_TOOLS=platformMcpTools(platform);
  const auth = authorizePlatformMcp(req,platform);
  if (auth !== 200) return Response.json({ error: auth === 503 ? 'workflow_mcp_not_configured' : 'unauthorized' }, { status: auth, headers });
  const protocol = req.headers.get('mcp-protocol-version');
  if (protocol && !VERSIONS.includes(protocol)) return rpcError(null, -32600, 'Unsupported MCP-Protocol-Version', 400);
  if (!req.headers.get('content-type')?.includes('application/json')) return rpcError(null, -32600, 'application/json required', 415);
  const accept = req.headers.get('accept') || '';
  if (!accept.includes('application/json') || !accept.includes('text/event-stream')) return rpcError(null, -32600, 'Accept must include application/json and text/event-stream', 406);
  if (Number(req.headers.get('content-length')) > 1048576) return rpcError(null, -32600, 'Request too large', 413);
  const body = await req.text();
  if (Buffer.byteLength(body) > 1048576) return rpcError(null, -32600, 'Request too large', 413);
  let message: Record<string, unknown>;
  try { const value = JSON.parse(body); if (!isRecord(value)) return rpcError(null, -32600, 'Invalid request', 400); message = value; }
  catch { return rpcError(null, -32700, 'Parse error', 400); }
  const id = message.id;
  if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') return rpcError(id ?? null, -32600, 'Invalid request', 400);
  if (id === undefined) return new Response(null, { status: 202, headers });
  if (typeof id !== 'string' && typeof id !== 'number') return rpcError(null, -32600, 'Invalid request ID', 400);
  const params = isRecord(message.params) ? message.params : {};
  let result: unknown;
  if (message.method === 'initialize') result = {
    protocolVersion: VERSIONS.includes(String(params.protocolVersion)) ? params.protocolVersion : VERSIONS[0],
    capabilities: { tools: {} }, serverInfo: { name: 'auto-parse-'+platform+'-publish', version: '0.1.0' },
    instructions: 'Platform-scoped '+platform+' publication only. Use approved workflows and existing task-owned browser runtime. Do not author arbitrary workflows or access other platforms. Public publication requires user authorization; preserve original request/session/task IDs and reconcile unknown results. Sessions do not survive restart.',
  };
  else if (message.method === 'ping') result = {};
  else if (message.method === 'tools/list') result = { tools: WORKFLOW_MCP_TOOLS };
  else if (message.method === 'tools/call') {
    if (!WORKFLOW_MCP_TOOLS.some(t => t.name === params.name)) return rpcError(id, -32602, 'Unknown tool');
    if (params.arguments !== undefined && !isRecord(params.arguments)) return rpcError(id, -32602, 'Invalid tool arguments');
    const args = (params.arguments || {}) as Record<string, unknown>;
    const definition = WORKFLOW_MCP_TOOLS.find(t => t.name === params.name)!;
    if (!validToolArguments(definition.inputSchema, args)) return rpcError(id, -32602, 'Invalid tool arguments');
    try {
      const data = await callPlatformTool(platform,String(params.name), args);
      const clean = redactWorkflowData(data) as Record<string, unknown>;
      const shot = isRecord(clean) && typeof clean.screenshot === 'string' ? clean.screenshot : undefined;
      const content: Array<Record<string, unknown>> = [];
      if (shot) delete clean.screenshot;
      content.push({ type: 'text', text: JSON.stringify(clean) });
      const match = shot?.match(/^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/);
      if (match) content.push({ type: 'image', mimeType: match[1], data: match[2] });
      result = { content, isError: false };
    } catch (error) {
      const safe = error instanceof WorkflowInputError || error instanceof WorkflowConflictError || (error instanceof Error && /^[a-z0-9_]+$/.test(error.message));
      result = { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: safe && error instanceof Error ? error.message : 'workflow_operation_failed' }) }] };
    }
  } else return rpcError(id, -32601, 'Method not found');
  return Response.json({ jsonrpc: '2.0', id, result }, { headers });
}

export async function platformMcpGet(req:Request,platform:string){
 if(!isPublicationPlatform(platform))return new Response(null,{status:404,headers});
 const auth=authorizePlatformMcp(req,platform);
 return new Response(null,{status:auth===200?405:auth,headers:{...headers,Allow:'POST'}});
}
