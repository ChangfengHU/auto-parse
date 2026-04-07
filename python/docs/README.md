# Python Layout

`doouyin` 的 Python 代码统一收敛在 `python/` 下，避免脚本散落到仓库根目录。

当前结构：

- `python/vendors/`
  说明：第三方或上游同步过来的 Python 包，尽量保持原始结构，便于后续升级和对比。
- `python/vendors/xiaohongshu_cli/`
  说明：当前接入的小红书 CLI 源码副本，Node 通过 `PYTHONPATH` 直接加载这里的 `xhs_cli` 包。
- `python/docs/`
  说明：记录目录约定、依赖说明、迁移说明。

后续新增 Python 能力时，建议遵循：

- `python/vendors/<upstream_name>/`
  说明：外部项目或开源工具的 vendor 副本。
- `python/apps/<domain_name>/`
  说明：本项目自有的 Python 入口、适配器、批处理脚本。
- `python/shared/`
  说明：多个 Python 子域复用的公共模块。

当前桥接约定：

- Node 默认把 `python/vendors/xiaohongshu_cli` 当作 `XHS_CLI_ROOT`
- Python 版本通过 `uv` 管理，当前固定在 `3.12`
- 解释器优先级：
  1. `XHS_CLI_PYTHON`
  2. `python/.venv/bin/python`
  3. `python/vendors/xiaohongshu_cli/.venv/bin/python`
  4. `python3`
  5. `python`

初始化方式：

- 首次拉项目后执行 `./python/scripts/setup-xhs-cli.sh`
- 脚本会用 `uv` 自动创建 `python/.venv`，并按 `python/vendors/xiaohongshu_cli/uv.lock` 同步依赖
- 如需切换目标版本，可传 `XHS_CLI_PYTHON_VERSION=3.12 ./python/scripts/setup-xhs-cli.sh`
- 如需显式指定已有解释器，可传 `XHS_CLI_BOOTSTRAP_PYTHON=/path/to/python3.12 ./python/scripts/setup-xhs-cli.sh`
