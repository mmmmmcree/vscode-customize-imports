param(
    [string]$CodeRoot = 'K:\Microsoft VS Code',
    [string]$LoaderRoot = 'C:\Users\mmmmmcree\.vscode\extensions\be5invis.vscode-custom-css-7.5.1',
    [string]$LanguagePacks = 'C:\Users\mmmmmcree\AppData\Roaming\Code\languagepacks.json',
    [string]$TestRoot,
    [string[]]$Locales = @('en', 'zh-cn')
)
$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $projectRoot
if (!$TestRoot) { $TestRoot = Join-Path $projectRoot 'test-results\installed-ui' }
$TestRoot = [System.IO.Path]::GetFullPath($TestRoot)
$testCodeRoot = Join-Path $TestRoot 'test-code'
if ([System.IO.Path]::GetFullPath($CodeRoot).TrimEnd('\') -eq $testCodeRoot.TrimEnd('\')) { throw 'Use a separate disposable copy of VS Code.' }
New-Item -Path $TestRoot -ItemType Directory -Force | Out-Null
if (!(Test-Path -LiteralPath (Join-Path $testCodeRoot 'Code.exe'))) {
    & robocopy $CodeRoot $testCodeRoot /E /XJ /R:1 /W:1 /NFL /NDL /NJH /NJS /NP
    if ($LASTEXITCODE -ge 8) { throw 'Could not copy VS Code for the isolated test.' }
}
$appRoot = (Get-ChildItem -LiteralPath $testCodeRoot -Filter product.json -Recurse | Where-Object { $_.Directory.Name -eq 'app' } | Select-Object -First 1).Directory.FullName
if (!$appRoot) { throw 'Could not locate copied VS Code app.' }
$workbench = Get-ChildItem -LiteralPath (Join-Path $appRoot 'out\vs\code') -Filter 'workbench.html' -Recurse | Select-Object -First 1
if (!$workbench -or !$workbench.FullName.StartsWith($testCodeRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid copied workbench path.' }
# Remove only the loader's patches in the disposable copy. Never touch the live app.
$html = [IO.File]::ReadAllText($workbench.FullName)
$html = [regex]::Replace($html, '<!-- !! VSCODE-CUSTOM-CSS-START !! -->[\s\S]*?<!-- !! VSCODE-CUSTOM-CSS-END !! -->\n*', '')
$html = [regex]::Replace($html, '<!-- !! VSCODE-CUSTOM-CSS-SESSION-ID [\w-]+ !! -->\n*', '')
$html = [regex]::Replace($html, '<script>/\* eslint-env browser \*/[\s\S]*?__CUSTOM_CSS_JS_INDICATOR_CLS[\s\S]*?</script>\n*', '')
[IO.File]::WriteAllText($workbench.FullName, $html)
$runRoot = Join-Path $TestRoot ('run-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss'))
$extensionsRoot = Join-Path $runRoot 'extensions'
$driverRoot = Join-Path $runRoot 'driver'
New-Item -Path $driverRoot -ItemType Directory -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $driverRoot 'package.json'), '{"name":"scm-installed-test-driver","publisher":"local-tests","version":"1.0.0","engines":{"vscode":"^1.90.0"},"main":"extension.js"}')
[IO.File]::WriteAllText((Join-Path $driverRoot 'extension.js'), 'exports.activate = () => {};')
& python ../scripts/install.py --plugin vscode-scm-line-stats --code (Join-Path $testCodeRoot 'bin\code.cmd') --extensions-dir $extensionsRoot --user-data-dir (Join-Path $runRoot 'cli-profile')
if ($LASTEXITCODE -ne 0) { throw 'VSIX installation failed.' }
$registryPath = Join-Path $extensionsRoot 'extensions.json'
$registry = @(Get-Content -LiteralPath $registryPath -Raw | ConvertFrom-Json)
$languageRegistry = Get-Content -LiteralPath $LanguagePacks -Raw | ConvertFrom-Json
$languageRoot = Split-Path (Split-Path $languageRegistry.'zh-cn'.translations.vscode -Parent) -Parent
foreach ($extensionRoot in @($LoaderRoot, $languageRoot)) {
    $folderName = Split-Path $extensionRoot -Leaf
    Copy-Item -LiteralPath $extensionRoot -Destination (Join-Path $extensionsRoot $folderName) -Recurse
    $manifest = Get-Content -LiteralPath (Join-Path $extensionRoot 'package.json') -Raw | ConvertFrom-Json
    $registry += @{
        identifier = @{ id = $manifest.publisher + '.' + $manifest.name }
        version = $manifest.version
        location = @{ '$mid' = 1; scheme = 'file'; path = '/' + (Join-Path $extensionsRoot $folderName).Replace('\', '/') }
        relativeLocation = $folderName
        metadata = @{ isMachineScoped = $false; isBuiltin = $false; source = 'vsix' }
    }
}
[IO.File]::WriteAllText($registryPath, (ConvertTo-Json -InputObject $registry -Depth 10))
$env:SCM_STATS_TEST_EXTENSIONS = $extensionsRoot
$codeExecutable = Join-Path $testCodeRoot 'Code.exe'
$playwrightRoot = Join-Path $appRoot 'node_modules\playwright-core'
foreach ($displayLocale in $Locales) {
    $resultRoot = Join-Path $runRoot $displayLocale
    $profileRoot = Join-Path $resultRoot 'profile'
    New-Item -Path (Join-Path $profileRoot 'User') -ItemType Directory -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $profileRoot 'User\settings.json'), '{"scm.defaultViewMode":"list","telemetry.telemetryLevel":"off","workbench.startupEditor":"none","extensions.autoUpdate":false,"vscode_custom_css.statusbar":false}')
    if ($displayLocale -eq 'zh-cn') { Copy-Item -LiteralPath $LanguagePacks -Destination (Join-Path $profileRoot 'languagepacks.json') }
    $env:SCM_STATS_TEST_RESULTS = $resultRoot
    & node scripts/prepare_smoke.js
    if ($LASTEXITCODE -ne 0) { throw 'Fixture preparation failed.' }
    $testWorkspace = (Get-Content -LiteralPath (Join-Path $resultRoot 'smoke-path.json') -Raw | ConvertFrom-Json).workspace
    foreach ($pass in @(1, 2)) {
        foreach ($name in @('native-host-release.txt', 'native-host-ready.json')) {
            $target = [IO.Path]::GetFullPath((Join-Path $resultRoot $name))
            if ([IO.Path]::GetDirectoryName($target) -ne $resultRoot) { throw 'Invalid test file path.' }
            if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target }
        }
        $launchArgs = @(
            "--locale=$displayLocale", '--user-data-dir', $profileRoot,
            '--extensions-dir', $extensionsRoot,
            '--extensionDevelopmentPath', $driverRoot,
            '--extensionTestsPath', (Join-Path $projectRoot 'test\installed-host.js'),
            '--remote-debugging-port=0', '--disable-workspace-trust',
            '--skip-welcome', '--skip-release-notes', '--new-window', '--verbose', $testWorkspace
        )
        $quotedArgs = $launchArgs | ForEach-Object { '"' + $_ + '"' }
        $testProcess = Start-Process -FilePath $codeExecutable -ArgumentList $quotedArgs -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $resultRoot 'native-ui-host.log') -RedirectStandardError (Join-Path $resultRoot 'native-ui-host-stderr.log')
        try {
            $deadline = [DateTime]::UtcNow.AddSeconds(60)
            $readyPath = Join-Path $resultRoot 'native-host-ready.json'
            while (!(Test-Path -LiteralPath $readyPath)) {
                if ([DateTime]::UtcNow -gt $deadline -or $testProcess.HasExited) { throw "Installed extension did not become ready: $displayLocale pass $pass; see $resultRoot" }
                Start-Sleep -Milliseconds 200
            }
            $ready = Get-Content -LiteralPath $readyPath -Raw | ConvertFrom-Json
            $expected = if ($pass -eq 1) { 'reload-required' } else { 'ready' }
            if ($ready.renderer.state -ne $expected) { throw "Expected $expected, got $($ready.renderer | ConvertTo-Json -Compress)" }
            if (@($ready.imports).Count -ne 1) { throw 'Renderer was not registered as one stable import.' }
            Copy-Item -LiteralPath $readyPath -Destination (Join-Path $resultRoot "installed-pass-$pass.json")
            if ($pass -eq 2) {
                & node scripts/test_native_ui.js $playwrightRoot $displayLocale
                if ($LASTEXITCODE -ne 0) { throw "Installed UI verification failed: $displayLocale" }
            }
        } finally {
            [IO.File]::WriteAllText((Join-Path $resultRoot 'native-host-release.txt'), 'done')
            if (!$testProcess.WaitForExit(15000)) { Stop-Process -Id $testProcess.Id -Force }
        }
    }
}
Write-Output "Installed VSIX UI checks passed: $runRoot"
