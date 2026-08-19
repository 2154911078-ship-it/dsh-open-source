# 鲨鱼帽小熊桌宠 (Shark Hood Bear Pet) + DSH 插件

一只戴着灰色鲨鱼头套的奶油色小熊桌宠，配套两个 DeepSeek Harness (DSH) 本地插件。

## 目录结构

```
shark-hood-bear-pet/
├── pet/                          # 桌宠源项目（图集、动作配置、源素材）
│   ├── pet.png                   # 动画图集 2048×2304（8列×9行，72格）
│   ├── pet.json                  # 动作配置（帧率、帧区间、循环、行为）
│   ├── frame_mapping.json        # 格位映射表
│   ├── frames/                   # 处理后的逐帧 PNG
│   ├── raw_frames/               # AI 原始帧
│   ├── README.md                 # 桌宠源项目说明
│   └── ...
└── plugins/
    ├── dsh-shark-pet/            # 桌宠静态插件（页面渲染桌宠）
    └── dsh-wallpaper-control/    # 壁纸控制静态插件（🖼️ 壁纸管理 + Cordis 面板简洁化）
```

## 动作列表（6 个动作，全部沿用 pet.json 规格）

| 动作 | 帧数 | 帧率 | 循环 | 说明 |
|------|------|------|------|------|
| idle | 12 | 6fps | 是 | 待机呼吸+眨眼 |
| walk | 16 | 10fps | 是 | 行走 |
| run | 12 | 12fps | 是 | 奔跑 |
| sleep | 8 | 4fps(客户端2fps) | 是 | 休眠 |
| interact | 12 | 8fps | 否 | 点击互动 |
| jump_fall | 8 | 8fps | 否 | 跳跃下落 |

## 插件功能

### dsh-shark-pet（桌宠）
- 全屏浮动桌宠，渲染于 shell.overlay
- 逐帧对齐补偿（消除 AI 帧抖动）
- 左键点击互动、拖拽甩出（带惯性奔跑）、右键头顶倒 U 弧形菜单
- 30 秒无操作自动入睡；互动/跳跃后清醒 5 秒
- 宿主路由：`/pet-assets/sprite.png`、`/pet-assets/config.json`

### dsh-wallpaper-control（壁纸控制）
- 右下角 🖼️ 壁纸管理面板：选择文件（系统文件选择器）、壁纸列表、透明度滑杆、暂停/播放、状态显示
- Cordis 插件面板简洁化 CSS（每插件一栏、最新版加粗、感叹号悬浮提示）
- 宿主路由：`/wallpaper/status`、`/wallpaper/list`

## 安装（DSH）

1. 将 `plugins/dsh-shark-pet`、`plugins/dsh-wallpaper-control` 复制到
   `C:\Users\<user>\.dsh\profiles\node_modules\`
2. 在 `C:\Users\<user>\.dsh\profiles\web\cordis.patch.yml` 追加：

```yaml
- insert:
    - id: "dsh-shark-pet"
      name: "dsh-shark-pet"
- insert:
    - id: "dsh-wallpaper-control"
      name: "dsh-wallpaper-control"
```

3. 重启 DSH 生效（静态插件默认启动）。

> 注意：桌宠图集默认读取 `D:/桌面/deepseek/shark_hood_bear_pet_full/pet/`，
> 如路径不同请修改 `dsh-shark-pet/lib/index.js` 中的 `PET_BASE`。

## 技术要点

- 图集：2048×2304 PNG，单格 256×256，锚点 (128, 230)
- 客户端：静态插件使用 `__ModuleLoader__.load` + `fetch` 宿主路由（无需 RPC）
- 帧对齐：每格 dx/dy 补偿，播放时逐帧校正脚底与水平中心

## 许可

仅供个人学习和非商业用途使用。
