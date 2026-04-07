# 本地启动说明

这份文档只回答三件事：

1. 第一次怎么把项目跑起来
2. 平时怎么启动
3. 后面继续接 Python 项目时，目录和依赖怎么管

## 1. 第一次启动

进入项目目录：

```bash
cd /Users/huchangfeng/doouyin
```

安装 Node 依赖：

```bash
npm install
```

初始化内置 Python 环境：

```bash
./python/scripts/setup-xhs-cli.sh
```

启动前端和 API：

```bash
npm run dev
```

默认访问地址：

```bash
http://localhost:1007
```

## 2. 日常启动

如果这台机器之前已经跑过 `setup-xhs-cli.sh`，平时只需要：

```bash
cd /Users/huchangfeng/doouyin
npm run dev
```

不需要每次都重新跑：

```bash
./python/scripts/setup-xhs-cli.sh
```

这个脚本只在下面这些情况需要重新执行：

- 第一次拉项目
- 换了一台新机器
- 手动删掉了 `python/.venv`
- `python/vendors/xiaohongshu_cli/uv.lock` 更新了
- Python 版本策略变了，比如从 `3.12` 升到别的版本

## 3. 项目现在怎么管理 Python

当前方案：

- Python 代码统一放在 `python/`
- 第三方或上游同步代码放在 `python/vendors/`
- 当前小红书 CLI vendored 在 `python/vendors/xiaohongshu_cli/`
- Python 版本由 `uv` 管理
- Python 虚拟环境固定在 `python/.venv`
- 依赖锁定文件使用 vendored 包自带的 `uv.lock`

关键文件：

- [python/scripts/setup-xhs-cli.sh](/Users/huchangfeng/doouyin/python/scripts/setup-xhs-cli.sh)
- [python/.python-version](/Users/huchangfeng/doouyin/python/.python-version)
- [python/vendors/xiaohongshu_cli/pyproject.toml](/Users/huchangfeng/doouyin/python/vendors/xiaohongshu_cli/pyproject.toml)
- [python/vendors/xiaohongshu_cli/uv.lock](/Users/huchangfeng/doouyin/python/vendors/xiaohongshu_cli/uv.lock)
- [lib/analysis/xhs-cli-bridge.ts](/Users/huchangfeng/doouyin/lib/analysis/xhs-cli-bridge.ts)

## 4. 小红书现在还需不需要 1030

不需要。

`doouyin` 里的这批小红书接口已经切成 Node 直接调用内置 Python：

- 刺探博主
- 热门 Feed
- 搜索
- 评论
- 未读通知

所以现在日常开发不需要再启动单独的 `1030` 服务。

## 5. 后面再引入 Python 项目，会不会更方便

会，已经比之前顺很多了。

原因：

- 现在有统一的 `python/` 目录，不会再把脚本散在仓库根目录
- 已经确定了 `vendors / apps / shared` 这种分层思路
- 已经有统一的 Node -> Python 桥接方式
- 已经切到 `uv` 管理 Python 版本和依赖，后面新增项目时可继续沿用

建议后面这样接：

- 外部项目副本放 `python/vendors/<project_name>/`
- 你自己写的 Python 业务放 `python/apps/<domain_name>/`
- 多个 Python 子域复用的公共能力放 `python/shared/`
- 每个独立 Python 项目都带自己的 `pyproject.toml` 和锁文件
- Node 侧统一通过桥接层调用，不要再回到散装 shell 脚本调用

## 6. 常见问题

### Q1. `npm run dev` 启动了，但小红书接口报 Python 找不到

先执行：

```bash
./python/scripts/setup-xhs-cli.sh
```

如果还是不行，再检查：

```bash
ls python/.venv/bin/python
```

### Q2. `setup-xhs-cli.sh` 会不会每次都重装依赖

不会。

它现在走 `uv sync --frozen`，会按锁文件校验环境；没变化时只会快速检查，不会每次全量重装。

### Q3. 可以手动指定 Python 版本吗

可以。

例如：

```bash
XHS_CLI_PYTHON_VERSION=3.12 ./python/scripts/setup-xhs-cli.sh
```

或者显式指定已有解释器：

```bash
XHS_CLI_BOOTSTRAP_PYTHON=/opt/homebrew/bin/python3.12 ./python/scripts/setup-xhs-cli.sh
```
