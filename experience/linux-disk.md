# Linux 磁盘扩容经验

## 场景
GCP/AWS 等云主机在控制台扩容磁盘后，VM 内部分区不会自动扩展，需要手动操作。

## 在线扩容步骤（无需重启）

```bash
# 1. 确认磁盘情况
lsblk
df -h

# 2. 安装 parted（如果没有）
sudo apt-get install -y parted

# 3. 扩展分区（以 /dev/sda 的第 1 个分区为例）
sudo parted /dev/sda resizepart 1 100%
# 如果提示 "Fix/Ignore?"，输入 Fix

# 4. 扩展文件系统
sudo resize2fs /dev/sda1

# 5. 验证
df -h /
```

## 注意事项

- `growpart` 在某些镜像中未安装（可用 `parted` 替代）
- `resize2fs` 适用于 ext4 文件系统；xfs 用 `xfs_growfs /`
- 如果磁盘是 100% 满的，先删除临时文件再装 parted：
  ```bash
  sudo rm -rf /var/cache/apt/archives/*.deb /var/lib/apt/lists/*
  sudo rm -f /swapfile  # 如果 swap 文件占了大量空间
  ```

## Swap 创建

磁盘扩容后创建 swap（推荐 4GB）：
```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```
