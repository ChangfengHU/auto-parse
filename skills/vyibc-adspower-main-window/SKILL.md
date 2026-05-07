---
name: vyibc-adspower-main-window
description: 恢复并置前 AdsPower 主界面窗口，适合 AdsPower 主页面被最小化、隐藏或切到后台时使用。
---

## 用途

用于把 `AdsPower Browser` 主界面重新拉回前台，而不是某个 `SunBrowser` 分身页面。

脚本会自动：

1. 查找 `adspower_global` 进程
2. 从进程环境里读取当前 `DISPLAY`
3. 在对应 X11 会话里查找标题包含 `AdsPower Browser` 的主窗口
4. 将主窗口重新映射并置前

## 使用

```bash
python3 skills/vyibc-adspower-main-window/scripts/restore_main_window.py
```

成功时会输出找到的窗口 ID，以及窗口是否已恢复为可见和活动状态。
