# 公众号GIF分阶段验收

时间：2026-10-30（Asia/Shanghai）。目标账号：唯伊不可。仅技术验收草稿，不公开发表。

| 阶段 | 实际结果 |
| --- | --- |
| 源文件 | 540×720，30个不同帧，每帧100毫秒，循环，111960字节 |
| 永久素材上传 | 生产wechat_upload_image返回media_id和mmbiz_gif地址 |
| 微信素材下载 | image/gif，30帧；SHA256与源文件完全一致 |
| 原生贴图创建 | 生产wechat_create_draft保存两图newspic；首图GIF，第二张静态对照 |
| 官方回读 | 类型、图片顺序及首图封面匹配 |
| 网页后台编辑器 | GIF可见；连续四帧的红色方块中心位置变化，实际动画播放 |
| 直接网页预览 | 微信环境异常验证阻挡；不跳过验证 |
| 手机预览与公开页面 | 未验证；未公开发表 |

样本SHA256：4a06984972e1d0089ef617116a9ae3de563f4937685d8c9d7c18b04f69254814。
样本地址：https://resource.vyibc.com/wechat-tests/gif-20261030/animation-proof.gif
草稿标题：GIF动效验证（勿发布）。
上传requestId：gif-e2e-20261030-upload-01；建稿requestId：gif-e2e-20261030-draft-01。可从请求账本查真实media_id，禁止用新ID重复创建验证稿。

原生预览弹窗允许选择已关注的微信号或扫码预览。本次未点击向预填联系人发送消息，也未点击发表。不能据此宣称公开发表的GIF在所有客户端都能播放。GIF不是苹果Live Photo；Live仍只有本地视频链接元数据。

服务能力声明0.3.1增加gifVerification分项；animatedGifVerified仍为false，避免把局部通过误报为端到端通过。测试结果不证明10MiB、16000高度或任何正文上限。此前另一Agent的16000像素实测只能视为那个样本的成功边界，不能认定为微信官方高度上限。
