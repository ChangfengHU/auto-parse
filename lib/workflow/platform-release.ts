import fs from 'node:fs';
import path from 'node:path';
import type {PublicationPlatform} from './platform-mcp-contract';

export const PLATFORM_RELEASE_VERSIONS:Record<PublicationPlatform,string>={wechat:'0.6.1',douyin:'0.3.1',xiaohongshu:'0.1.1',x:'0.1.1'};
export function platformReleaseInfo(platform:PublicationPlatform){
 const version=PLATFORM_RELEASE_VERSIONS[platform];
 const filename=process.env.AUTO_PARSE_RELEASE_METADATA||path.join(process.cwd(),'.runtime/x-publish/platform-release.json');
 let metadata:{deploy_id?:unknown;git_commit?:unknown;deployed_at?:unknown;working_tree_dirty?:unknown;versions?:Record<string,string>}={};
 try {metadata=JSON.parse(fs.readFileSync(filename,'utf8'))} catch { /* Report missing metadata truthfully. */ }
 const valid=metadata.versions?.[platform]===version;
 const deploy_id=valid&&typeof metadata.deploy_id==='string'?metadata.deploy_id:null;
 const git_commit=valid&&typeof metadata.git_commit==='string'&&/^[a-f0-9]{40}$/.test(metadata.git_commit)?metadata.git_commit:null;
 const deployed_at=valid&&typeof metadata.deployed_at==='string'&&/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(metadata.deployed_at)&&Number.isFinite(Date.parse(metadata.deployed_at))?metadata.deployed_at:null;
 return {server:'auto-parse-'+platform+'-publish',version,server_version:version,working_tree_dirty:valid&&typeof metadata.working_tree_dirty==='boolean'?metadata.working_tree_dirty:null,git_commit_note:'Git HEAD at build; working_tree_dirty indicates whether other tracked changes were present.',deploy_id,deploy_id_source:deploy_id?'auto_parse_release_record':null,git_commit,deployed_at,changelog_zh:platform==='douyin'?'0.3.1：任务页固定桌面视口，准备与发布共用按钮可点击检查；受阻在预留提交前停止，错误保留阶段/提交状态与视口。统一页面与MCP视频字段，支持workId复用渠道/账号标题正文标签封面，返回完整publicationInput并留存投递；未知参数拒绝，prepare不冒充云草稿。':platform==='wechat'?'0.6.1：公众号已发表文章候选支持关键词搜索与分页，默认最近7天和未加入任何合集；新增合集成员回读与异步批量归类、默认只预览、跳过已有成员、稳定请求防重、保留合集版本和保存后重新打开核对。创建定时任务及视频/贴图归类不在本轮验收范围。':'平台原有发布能力保持不变。',metadata_verified:!!(deploy_id&&git_commit&&deployed_at)};
}
