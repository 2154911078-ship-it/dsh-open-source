# 生成图片的包装脚本（Windows PowerShell）
#
# 作用：自动处理加速工具（Steam++ / Watt Toolkit）的根证书，再调用 gen-image.mjs。
#   · Steam++ 用本地反代 + 自签证书替换 HTTPS 证书，而 Node 不读 Windows 证书库，
#     所以必须通过 NODE_EXTRA_CA_CERTS 明确告诉 Node 信任它。
#   · 如果你没开加速工具（能直连），这段会自动跳过。
#
# 用法（与 gen-image.mjs 完全一致）：
#   .\run-gen.ps1 "一只线条小狗在喝奶茶"
#   .\run-gen.ps1 "线条小狗头像" -o avatar.png --size 2048x2048

[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Args
)

$ErrorActionPreference = 'Stop'

$certs = @(
    "$env:LOCALAPPDATA\Steam++\Plugins\Accelerator\SteamTools.Certificate.cer",
    "$env:ProgramFiles\Steam++\Plugins\Accelerator\SteamTools.Certificate.cer"
)
foreach ($cert in $certs) {
    if ((Test-Path $cert) -and -not $env:NODE_EXTRA_CA_CERTS) {
        $env:NODE_EXTRA_CA_CERTS = $cert
        Write-Verbose "已加载加速工具证书: $cert"
        break
    }
}

$node = if (Test-Path 'D:\node\node.exe') { 'D:\node\node.exe' } else { 'node' }
& $node (Join-Path $PSScriptRoot 'gen-image.mjs') @Args
exit $LASTEXITCODE
