# 当前远端开发与部署规范

本文记录 `152.32.214.95:/root/auto-parse` 当前事实。`deploy/README.md` 和 `deploy/*.sh` 是历史 Docker/镜像推送方案，未经负责人批准不得用于当前远端。

## 强制边界
- 只允许 SSH 登录远端后审计、手工修改、重启和测试。
- 禁止 `scp`、`rsync`、Git push/pull 或其他方式同步本地项目文件、代码、补丁。
- 禁止本地 checkout 覆盖远端；必须保护已有未提交修改。
- 工作流配置通过 Supabase 正式配置源修改和验证，不以本地 JSON 为准。
- 禁止把密码、Token、Cookie、私钥或环境变量值写入记录和 Git。

## 当前服务
```text
WorkingDirectory=/root/auto-parse
Service=auto-parse.service
Command=npm run dev -- -p 1007
Port=1007
Public URL=https://parse.vyibc.com
```
当前运行在 `NODE_ENV=development`。是否迁移生产构建由 `INFRA-001` 决策，普通业务任务不得顺手改变。

## 标准流程
```bash
ssh root@152.32.214.95
cd /root/auto-parse
git status --short
systemctl status auto-parse.service --no-pager -l
```

修改必须在远端完成。按范围执行 Lint、TypeScript、Build。全仓失败时区分本任务问题和已有错误并记录。业务代码、运行配置或依赖变化后才重启；纯文档变化不重启。

```bash
systemctl restart auto-parse.service
systemctl status auto-parse.service --no-pager -l
ss -lntp | grep ':1007'
curl -fsS http://127.0.0.1:1007/
```

页面验证使用 `https://parse.vyibc.com`。工作流修改必须访问真实工作流并触发对应路径；图片存储需验证最终 URL、格式、尺寸和文件大小。

## Git、记录与回滚
- 当前远端禁止 Push/Pull；需要提交时只暂存本任务文件。
- 每次修改维护 `TASKS.md` 和对应 `dev-log`。
- 禁止 `git reset --hard` 或覆盖整个文件回滚；先审计再最小范围手工修复。
- Supabase 工作流和远程存储变更必须单独制定回滚步骤。

## 双环境交付要求

本地和远端目标业务语义必须保持一致，但必须分别手工实现和验证。每项任务必须记录本地与远端涉及文件、检查结果、远端重启与公网验证、共享 Supabase/R2/OSS 配置状态以及剩余差异。任一环境未实现或未验证时，任务不能标记 Done。
- 远端修改必须在远端独立验证；验证通过后必须在远端及时提交并 `git push`，保存远端已验证成果。
- AdsPower 浏览器执行现场通过 `https://vnc.vyibc.com/vnc.html?path=websockify&autoconnect=1&reconnect=1` 查看，尤其用于判断生图、按钮状态和下载动作。
