# dsh-boot-fix.ps1 — 开机卡 logo 修复脚本（需管理员运行）
# 1) 禁用两个损坏的开机自启服务 2) 关闭快速启动 3) 清理 C:\Drivers 残留空目录
$ErrorActionPreference = 'Continue'
$log = 'D:\桌面\deepseek\dsh-boot-fix-log.txt'
"=== 开机修复脚本执行 @ $(Get-Date) ===" | Out-File $log -Encoding utf8

"--- [1] 禁用失效服务 ---" | Out-File $log -Append -Encoding utf8
sc.exe config ardrv start= disabled 2>&1 | Out-File $log -Append -Encoding utf8
sc.exe config BackgroundController start= disabled 2>&1 | Out-File $log -Append -Encoding utf8

"--- [1b] 验证 ---" | Out-File $log -Append -Encoding utf8
sc.exe qc ardrv 2>&1 | Select-String 'START_TYPE' | Out-File $log -Append -Encoding utf8
sc.exe qc BackgroundController 2>&1 | Select-String 'START_TYPE' | Out-File $log -Append -Encoding utf8

"--- [2] 关闭快速启动 (powercfg /h off) ---" | Out-File $log -Append -Encoding utf8
powercfg /h off 2>&1 | Out-File $log -Append -Encoding utf8
powercfg /a 2>&1 | Select-String '休眠|快速启动' | Out-File $log -Append -Encoding utf8

"--- [3] 清理 C:\Drivers 空目录 ---" | Out-File $log -Append -Encoding utf8
foreach ($d in @('Kf', 'LVlLfDT', 'w8HZUN')) {
    $p = "C:\Drivers\$d"
    if (Test-Path $p) {
        $items = @(Get-ChildItem $p -Force -Recurse -ErrorAction SilentlyContinue)
        if ($items.Count -eq 0) {
            Remove-Item $p -Force -ErrorAction SilentlyContinue
            if (Test-Path $p) { "删除失败: $p" | Out-File $log -Append -Encoding utf8 }
            else { "已删除空目录: $p" | Out-File $log -Append -Encoding utf8 }
        } else {
            "目录非空，跳过: $p ($($items.Count) 项)" | Out-File $log -Append -Encoding utf8
        }
    } else {
        "不存在: $p" | Out-File $log -Append -Encoding utf8
    }
}

"=== 完成 @ $(Get-Date) ===" | Out-File $log -Append -Encoding utf8
