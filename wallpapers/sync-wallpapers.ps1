# dsh 壁纸库同步脚本
# 用法：把壁纸图片（gif/png/jpg/jpeg/webp/bmp）放进本文件夹（默认 $PSScriptRoot），
#       然后运行本脚本。它会把图片安装到 GUI 的壁纸库并生成清单文件。
#       之后在网页侧栏「插件」面板中点击 🔄 刷新，即可看到并切换壁纸。无需重启。
#       目标目录可用 -DistPaths 参数覆盖（例如指向其它 DSH 安装的 dist\assets\wallpapers）。
param(
  [string[]]$DistPaths = @(
    "C:\Users\lenovo\.dsh\profiles\node_modules\@deepseek-ai\dsh-web-frontend\dist\assets\wallpapers",
    "C:\Users\lenovo\AppData\Local\npm-cache\_npx\1e7f6d9597241db0\node_modules\@deepseek-ai\dsh-web-frontend\dist\assets\wallpapers"
  )
)
$ErrorActionPreference = "Stop"

$src = $PSScriptRoot
$dists = $DistPaths
$allowed = @(".gif", ".png", ".jpg", ".jpeg", ".webp", ".bmp")

$files = Get-ChildItem -LiteralPath $src -File | Where-Object { $allowed -contains $_.Extension.ToLowerInvariant() }
if ($files.Count -eq 0) {
  Write-Host "未找到壁纸图片，请先把图片放进 $src"
  exit 1
}

$items = @()
foreach ($f in $files) {
  $items += [pscustomobject]@{
    id   = $f.BaseName
    name = $f.Name
    file = $f.Name
    rev  = "$($f.Length):$([int64]$f.LastWriteTimeUtc.Ticks)"
  }
}
$manifest = @{ wallpapers = $items } | ConvertTo-Json -Depth 5

foreach ($d in $dists) {
  New-Item -ItemType Directory -Force -Path $d | Out-Null
  Get-ChildItem -LiteralPath $d -File -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
  foreach ($f in $files) { Copy-Item -LiteralPath $f.FullName -Destination $d -Force }
  [System.IO.File]::WriteAllText((Join-Path $d "manifest.json"), $manifest, (New-Object System.Text.UTF8Encoding($false)))
}

Write-Host "已安装 $($files.Count) 张壁纸："
$files | ForEach-Object { Write-Host "  - $($_.Name) ($([math]::Round($_.Length / 1MB, 1)) MB)" }
Write-Host "在网页侧栏「插件」面板中点击 🔄 即可看到并切换。"
