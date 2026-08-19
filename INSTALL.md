# 从零复现「线条小狗的 DSH」完整安装指南

本指南面向**拿到本仓库、想装出和作者一模一样界面**的人。按顺序执行即可。

> 目标效果：动态壁纸 + 右上角透明度滑块 + 右下角壁纸管理面板 + 鲨鱼帽小熊桌宠 + `@文件` 选择，整体深色主题，界面与作者一致。

---

## 第 0 步：准备

- **系统**：Windows 10/11（作者环境为 Windows）
- **Node.js**：≥ 20（推荐 22 LTS 或更高）
- **包管理器**：npm 自带即可；可选安装 [pnpm](https://pnpm.io/installation)
- **网络**：能访问 npm registry 和 GitHub

在 PowerShell 中验证：

```powershell
node -v
npm -v
git --version   # 可选，用于克隆仓库
```

---

## 第 1 步：安装 DSH 本体

DSH（DeepSeek Harness）本体通过 npm 启动，作者使用版本为 `0.1.0-rc.7`：

```powershell
npx -y @deepseek-ai/dsh@0.1.0-rc.7
```

首次运行会：
1. 下载 DSH 全家桶依赖（较多，耐心等待）
2. 在 `%USERPROFILE%\.dsh\` 下创建配置目录
3. 启动 Web 服务（默认 http://127.0.0.1:3080）

**注意**：`npx` 缓存安装的位置在
`%LOCALAPPDATA%\npm-cache\_npx\<hash>\node_modules\`，这是正常的。

启动成功后浏览器打开 http://127.0.0.1:3080 应能看到 DSH 界面。

> 如果后续步骤需要重启 DSH：Ctrl+C 停掉进程后重新执行 `npx -y @deepseek-ai/dsh@0.1.0-rc.7`。

---

## 第 2 步：配置 AI 模型（API Key）

DSH 需要 API Key 才能对话。作者在 `%USERPROFILE%\.dsh\settings.yaml` 中配置了
`agent-default-model`，且 Key 通过**环境变量**读取（不在配置文件里，更安全）。

**方式一（推荐，环境变量）：**

1. 打开系统设置 → 环境变量（或 PowerShell 执行 `setx OPENAI_API_KEY "你的key"`）
2. 设置你所用服务商的 Key 环境变量，例如：
   - `OPENAI_API_KEY`（OpenAI 兼容接口）
   - `DEEPSEEK_API_KEY`（DeepSeek 官方）
3. 重启 DSH，在界面左下角「设置」→「模型」中选择模型

**方式二（直接写配置文件）：**

编辑 `%USERPROFILE%\.dsh\settings.yaml`，加入：

```yaml
agent-default-model:
  provider: deepseek-official
  model: deepseek-v4-flash
  reasoningEffort: high
```

> ⚠️ 密钥属于你个人，不要提交到任何公开仓库。本仓库**不包含**任何密钥。

---

## 第 3 步：安装「线条小狗」的全部插件

### 3.1 克隆/下载本仓库

```powershell
cd D:\
git clone https://github.com/2154911078-ship-it/dsh-open-source.git
# 或直接下载 zip 解压
```

### 3.2 复制插件到 DSH profile

把以下 **4 个插件** 复制到 DSH profile 的 node_modules：

```powershell
# 1. GIF 动态壁纸
Copy-Item D:\dsh-open-source\dsh-gif-wallpaper C:\Users\<你的用户名>\.dsh\profiles\node_modules\ -Recurse

# 2. @文件 选择
Copy-Item D:\dsh-open-source\dsh-at-file C:\Users\<你的用户名>\.dsh\profiles\node_modules\ -Recurse

# 3. 鲨鱼帽小熊桌宠（在桌宠项目里）
Copy-Item D:\dsh-open-source\shark-hood-bear-pet\plugins\dsh-shark-pet C:\Users\<你的用户名>\.dsh\profiles\node_modules\ -Recurse

# 4. 壁纸控制
Copy-Item D:\dsh-open-source\shark-hood-bear-pet\plugins\dsh-wallpaper-control C:\Users\<你的用户名>\.dsh\profiles\node_modules\ -Recurse
```

> `<你的用户名>` 替换为你的 Windows 用户名。

### 3.3 声明插件（cordis.patch.yml）

编辑 `C:\Users\<你的用户名>\.dsh\profiles\web\cordis.patch.yml`，追加：

```yaml
- insert:
    - id: "dsh-gif-wallpaper"
      name: "dsh-gif-wallpaper"
- insert:
    - id: "dsh-at-file"
      name: "dsh-at-file"
- insert:
    - id: "dsh-shark-pet"
      name: "dsh-shark-pet"
- insert:
    - id: "dsh-wallpaper-control"
      name: "dsh-wallpaper-control"
```

> 注意：如果该文件里已有其他 insert 条目，**追加**即可，不要删除原有的。

### 3.4 重启 DSH

Ctrl+C 停止 DSH，重新 `npx -y @deepseek-ai/dsh@0.1.0-rc.7`。

刷新页面后应看到：
- 🖼️ 右上角「空心星 + 竖条滑块」（壁纸透明度）
- 🐻 鲨鱼帽小熊桌宠在页面上浮动
- 🖼️ 右下角壁纸管理按钮

---

## 第 4 步：安装壁纸库

作者使用一张 22MB 的动态壁纸。有两种方式：

### 方式一：直接用仓库里的壁纸（简单）

1. 复制 `wallpapers/steam-wallpaper.gif` 到任意位置
2. 设置环境变量指向它：

```powershell
setx DSH_WALLPAPER_PATH "D:\wallpapers\steam-wallpaper.gif"
```

3. 重启 DSH 生效。

### 方式二：安装到壁纸库（可多张切换）

1. 把想要的壁纸图片（gif/png/jpg/webp）放进 `wallpapers/` 文件夹
2. 运行同步脚本（参数可指定你的 DSH 安装位置）：

```powershell
cd D:\dsh-open-source\wallpapers
powershell -File sync-wallpapers.ps1
# 如果你的 DSH 安装路径不同：
# powershell -File sync-wallpapers.ps1 -DistPaths "C:\你的安装路径\dist\assets\wallpapers"
```

3. 打开网页 → 左下角「插件」→ 壁纸列表 → 🔄 刷新 → 点击切换

---

## 第 5 步：桌宠素材路径（可选检查）

`dsh-shark-pet` 插件会自动按以下顺序寻找桌宠图集：

1. 环境变量 `DSH_PET_BASE`（推荐）
2. 仓库内相对路径 `shark-hood-bear-pet/pet/pet`
3. 作者机器的绝对路径（仅作者本机可用）

如果你克隆了完整仓库且插件在默认位置，第 2 条会自动命中，**无需配置**。
如果桌宠不显示，请显式设置：

```powershell
setx DSH_PET_BASE "D:\dsh-open-source\shark-hood-bear-pet\pet\pet"
```

---

## 第 6 步：深色主题（与作者一致）

作者界面为深色主题（`ui-theme.preference: dark`）。

编辑 `%USERPROFILE%\.dsh\settings.yaml`：

```yaml
ui-theme:
  preference: dark
```

或直接在界面「设置」里切换主题。

---

## 完成！验收清单

对照以下项目，全部符合即复现成功：

- [ ] 页面背景为动态壁纸（GIF 动画）
- [ ] 右上角星标 + 滑块可调壁纸透明度
- [ ] 右下角 🖼️ 可管理壁纸（选择文件/列表/暂停）
- [ ] 鲨鱼帽小熊桌宠在页面浮动（点击互动/拖拽/睡觉）
- [ ] 输入框输入 `@` 弹出文件选择器
- [ ] 整体深色主题

---

## 常见问题

| 问题 | 解决 |
|---|---|
| 壁纸不显示 | 检查 `DSH_WALLPAPER_PATH` 或壁纸库 manifest |
| 桌宠不显示 | 检查 `DSH_PET_BASE` 指向的 `pet.png` 是否存在 |
| 插件面板里没有插件 | 检查 `cordis.patch.yml` 条目 + 插件是否复制到 node_modules |
| 无法对话 | 检查 API Key 环境变量与模型选择 |
| 端口被占用 | DSH 默认 3080，可在启动参数中更换 |

---

*本文档由作者整理，对应 DSH `0.1.0-rc.7`。DSH 本体更新后部分路径可能变化，以实际为准。*
