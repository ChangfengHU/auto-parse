# AdsPower 使用经验

## 端口说明

| 端口 | 用途 | 何时激活 |
|------|------|---------|
| 20725 | AdsPower 内部 HTTP API | 进程启动后立即可用 |
| 50325 | Local API（供外部调用） | **必须用户在 GUI 登录后才激活** |

在无头服务器上，需要通过 VNC 进入桌面，手动登录 AdsPower GUI，才能让 50325 端口正常工作。

## `browser/active` 接口的坑

`GET /api/v1/browser/active?user_id=xxx` 会返回**缓存状态**，浏览器已经崩溃但接口仍可能返回 `code=0`（活跃）。

**正确做法**：用 `local-active` 接口获取真实进程列表：
```bash
curl -s "http://127.0.0.1:50325/api/v1/browser/local-active" \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
ids = [x['user_id'] for x in d.get('data', {}).get('list', [])]
print(','.join(ids))
"
```

## 浏览器崩溃后重启标准操作

直接 `browser/start` 不够，因为 AdsPower 可能认为实例"已在运行"（残留 startup 文件）。必须先 stop 再 start：

```bash
# 1. 先 stop（清除残留状态）
curl -s "http://127.0.0.1:50325/api/v1/browser/stop?user_id=$ID"
sleep 1
# 2. 再 start
curl -s "http://127.0.0.1:50325/api/v1/browser/start?user_id=$ID"
```

## AdsPower 安装（无 deb 包时）

官方 deb 下载经常失效（0 byte）。备选方案：**从已安装的机器 tar 打包复制**：

```bash
# 在已安装的旧机器上
sudo tar czf /tmp/adspower.tar.gz -C /opt 'AdsPower Global'

# 传到新机器
scp /tmp/adspower.tar.gz user@new-machine:/tmp/

# 在新机器上解压
sudo tar xzf /tmp/adspower.tar.gz -C /opt/
# 注意：解压后检查路径，有时会嵌套成 /opt/opt/AdsPower Global/
# 如果出现嵌套：
sudo mv '/opt/opt/AdsPower Global' '/opt/AdsPower Global'
```

## hosts 文件配置

AdsPower 需要 `local.adspower.net` 解析到本机：
```bash
echo "127.0.0.1 local.adspower.net" | sudo tee -a /etc/hosts
```

## 代理配置

浏览器分身创建时，proxy 设置为 `http://127.0.0.1:7890`（clash/tun2socks 监听端口）。

## 分身 user_id 获取

登录 AdsPower GUI → 右键分身 → 查看 user_id，或：
```bash
curl -s "http://127.0.0.1:50325/api/v1/user/list?page=1&page_size=50" | python3 -c "
import sys,json
d=json.load(sys.stdin)
for u in d.get('data',{}).get('list',[]):
    print(u['user_id'], u.get('name',''))
"
```
