import fs from 'node:fs';
import path from 'node:path';
import type {PublicationPlatform} from './platform-mcp-contract';

export const PLATFORM_RELEASE_VERSIONS:Record<PublicationPlatform,string>={wechat:'0.4.2',douyin:'0.1.1',xiaohongshu:'0.1.1',x:'0.1.1'};
export function platformReleaseInfo(platform:PublicationPlatform){
 const version=PLATFORM_RELEASE_VERSIONS[platform];
 const filename=process.env.AUTO_PARSE_RELEASE_METADATA||path.join(process.cwd(),'.runtime/x-publish/platform-release.json');
 let metadata:{deploy_id?:unknown;git_commit?:unknown;deployed_at?:unknown;working_tree_dirty?:unknown;versions?:Record<string,string>}={};
 try {metadata=JSON.parse(fs.readFileSync(filename,'utf8'))} catch { /* Report missing metadata truthfully. */ }
 const valid=metadata.versions?.[platform]===version;
 const deploy_id=valid&&typeof metadata.deploy_id==='string'?metadata.deploy_id:null;
 const git_commit=valid&&typeof metadata.git_commit==='string'&&/^[a-f0-9]{40}$/.test(metadata.git_commit)?metadata.git_commit:null;
 const deployed_at=valid&&typeof metadata.deployed_at==='string'&&/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(metadata.deployed_at)&&Number.isFinite(Date.parse(metadata.deployed_at))?metadata.deployed_at:null;
 return {server:'auto-parse-'+platform+'-publish',version,server_version:version,working_tree_dirty:valid&&typeof metadata.working_tree_dirty==='boolean'?metadata.working_tree_dirty:null,git_commit_note:'Git HEAD at build; working_tree_dirty indicates whether other tracked changes were present.',deploy_id,deploy_id_source:deploy_id?'auto_parse_release_record':null,git_commit,deployed_at,changelog_zh:'新增公众号人工协助入口并修复草稿箱入口；其他平台保留自身版本工具。',metadata_verified:!!(deploy_id&&git_commit&&deployed_at)};
}
