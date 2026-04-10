---
name: vyibc-ads-us-egress-stable
description: 一键修复 AdsPower 美国出口（强制启动参数代理、重启分身、验IP、持久化自愈配置）。
---

## 用途

用于快速把 Ads 分身出口稳定到美国，并确保重启后自动恢复同样策略。

## 使用

```bash
# 默认修复 3 个实例（k1b908rw,k1b8yqxe,k1ba8vac）
bash skills/vyibc-ads-us-egress-stable/scripts/ensure-us-egress.sh

# 指定实例
TARGET_IDS_CSV="k1b908rw,k1b8yqxe" bash skills/vyibc-ads-us-egress-stable/scripts/ensure-us-egress.sh

# 指定代理
PROXY_HOST="direct.miyaip.online" \
PROXY_PORT="8001" \
PROXY_USER="sqzaceacxr" \
PROXY_PASS="orwmoyumoopmoot" \
bash skills/vyibc-ads-us-egress-stable/scripts/ensure-us-egress.sh
```

## 默认值

- Ads API: `http://127.0.0.1:50325`
- 目标实例: `k1b908rw,k1b8yqxe,k1ba8vac`
- 代理: `direct.miyaip.online:8001`
- 启动参数:
  - `--no-sandbox`
  - `--disable-dev-shm-usage`
  - `--proxy-server=http://direct.miyaip.online:8001`
  - `--proxy-bypass-list=<-loopback>`
  - `--disable-quic`

