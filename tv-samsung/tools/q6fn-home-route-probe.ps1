param(
    [Parameter(Mandatory = $true)]
    [string]$Target,

    [string]$SdbPath = "$env:LOCALAPPDATA\sdburi\sdb.exe"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $SdbPath -PathType Leaf)) {
    throw "SDB introuvable : $SdbPath"
}

function Assert-ReadOnlyCommand {
    param([Parameter(Mandatory = $true)][string]$Command)

    $forbidden = @(
        '(?i)\bsqlite3\b[^\r\n]*(?:\bUPDATE\b|\bINSERT\b|\bDELETE\b|\bREPLACE\b|\bDROP\b|\bALTER\b|\bCREATE\b|\bVACUUM\b|\bATTACH\b|\bDETACH\b)',
        '(?i)\bvconftool\s+(?:set|unset|add)\b',
        '(?im)^\s*(?:mount|umount|reboot|poweroff|shutdown|rm|mv|cp|chmod|chown|dd|kill|pkill)\b',
        '(?i)\bsystemctl\s+(?:start|stop|restart|enable|disable|mask|unmask)\b',
        '(?i)\bvd_app(?:install|uninstall)\b',
        '(?i)\barchive-root\b',
        '(?i)\bsdbd-tarlauncher\s+--',
        '(?i)\bsetcap\b|\bsetfattr\b|\bchsmack\b'
    )

    foreach ($pattern in $forbidden) {
        if ($Command -match $pattern) {
            throw "Commande refusée par la garde read-only ($pattern)"
        }
    }
}

function Invoke-SdbReadOnly {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Command
    )

    Assert-ReadOnlyCommand -Command $Command
    Write-Output "===== $Name ====="
    Write-Output "COMMAND=$Command"

    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & $SdbPath -s $Target shell $Command 2>&1
        $exitCode = $LASTEXITCODE
        foreach ($line in $output) {
            Write-Output ([string]$line)
        }
        Write-Output "EXIT_CODE=$exitCode"
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
}

Write-Output 'SEENIT_Q6FN_HOME_ROUTE_PROBE=1'
Write-Output "TARGET=$Target"
Write-Output "SDB=$SdbPath"
Write-Output 'MODE=READ_ONLY'

$devices = & $SdbPath devices 2>&1
$devicesExitCode = $LASTEXITCODE
Write-Output '===== SDB_DEVICES ====='
$devices | ForEach-Object { Write-Output ([string]$_) }
Write-Output "EXIT_CODE=$devicesExitCode"
if ($devicesExitCode -ne 0 -or (($devices -join "`n") -notmatch [regex]::Escape($Target))) {
    throw "La cible '$Target' n'est pas présente dans 'sdb devices'. Le probe ne lance pas 'sdb connect'."
}

$commands = @(
    @{
        Name = 'IDENTITY_PLATFORM'
        Command = @'
id; uname -a; cat /etc/os-release 2>/dev/null || true; cat /etc/tizen-release 2>/dev/null || true; vconftool get db/product/modelcode 2>&1 || true; vconftool get db/product/firmware_version 2>&1 || true
'@
    },
    @{
        Name = 'RUNTIME_FILES_CAPS'
        Command = @'
ls -l /usr/bin/corerun /usr/bin/dotnet /usr/sbin/sdbd-tarlauncher 2>/dev/null || true; command -v getcap >/dev/null 2>&1 && getcap /usr/bin/corerun /usr/bin/dotnet /usr/sbin/sdbd-tarlauncher 2>/dev/null || true; readlink -f /usr/share/dotnet.tizen/netcoreapp 2>/dev/null || true; ls -la /usr/share/dotnet.tizen/netcoreapp 2>/dev/null || true; ls -la /usr/share/dotnet/shared/Microsoft.NETCore.App 2>/dev/null || true
'@
    },
    @{
        Name = 'TAR_NAMESPACE'
        Command = @'
/usr/bin/tar --version 2>&1 | head -n 2; /usr/bin/tar --help 2>&1 | grep -F -- '--to-command' || true; ls -l /proc/self/ns/mnt 2>/dev/null || true; readlink /proc/self/ns/mnt 2>/dev/null || true
'@
    },
    @{
        Name = 'HOME_LIBRARIES'
        Command = @'
ls -l /usr/lib/libaul.so /usr/lib/libaul.so.0 /usr/lib/libcapi-appfw-app-operation-tv.so /usr/lib/libcapi-appfw-app-operation-tv.so.0 /usr/lib/libvconf.so /usr/lib/libvconf.so.0 /usr/lib/libapp-context-manager-common.so /usr/lib/libapp-context-manager-common.so.0 2>/dev/null || true
'@
    },
    @{
        Name = 'HOME_SYMBOLS'
        Command = @'
if command -v strings >/dev/null 2>&1; then for f in /usr/lib/libaul.so /usr/lib/libaul.so.0 /usr/lib/libcapi-appfw-app-operation-tv.so /usr/lib/libcapi-appfw-app-operation-tv.so.0 /usr/lib/libvconf.so /usr/lib/libvconf.so.0 /usr/lib/libapp-context-manager-common.so /usr/lib/libapp-context-manager-common.so.0; do if [ -r "$f" ]; then echo "LIB=$f"; strings "$f" | grep -E 'app_control_set_defapp|app_operation_(get|set)_current_app|aul_get_default_app|aul_svc_set_operation|vconf_(get|set)_(str|int)|app_context_db_change' | sort -u || true; fi; done; else echo 'STRINGS_UNAVAILABLE=1'; fi
'@
    },
    @{
        Name = 'VCONF_HOME_BASELINE'
        Command = @'
for k in db/appfw/home_appid db/appfw/startup_appid db/appfw/booting_appid_backup db/appfw/overlay_home_appid db/first_screen/type db/menu/smart_hub/ontvsetting/auto_start; do echo "KEY=$k"; vconftool get "$k" 2>&1 || true; done
'@
    },
    @{
        Name = 'APP_CONTEXT_DB_METADATA'
        Command = @'
stat -c '%n|%U|%G|%a|%s' /opt/dbspace/.app-context.db 2>/dev/null || true; command -v sha256sum >/dev/null 2>&1 && sha256sum /opt/dbspace/.app-context.db 2>/dev/null || true; ls -lZ /opt/dbspace/.app-context.db 2>/dev/null || ls -l /opt/dbspace/.app-context.db 2>/dev/null || true
'@
    },
    @{
        Name = 'APP_CONTEXT_DB_SCHEMA'
        Command = @'
sqlite3 -readonly /opt/dbspace/.app-context.db '.schema key_filter' 2>&1 || true
'@
    },
    @{
        Name = 'APP_CONTEXT_DB_INTEGRITY'
        Command = @'
sqlite3 -readonly /opt/dbspace/.app-context.db 'PRAGMA query_only=ON; PRAGMA integrity_check;' 2>&1 || true
'@
    },
    @{
        Name = 'APP_CONTEXT_HOME_ROW_41'
        Command = @'
sqlite3 -readonly /opt/dbspace/.app-context.db 'PRAGMA query_only=ON; SELECT rowid,* FROM key_filter WHERE rowid=41;' 2>&1 || true
'@
    },
    @{
        Name = 'APP_CONTEXT_ALL_HOME_ROWS'
        Command = @'
sqlite3 -readonly /opt/dbspace/.app-context.db 'PRAGMA query_only=ON; SELECT rowid,* FROM key_filter;' 2>/dev/null | grep -F 'XF86Home' || true
'@
    },
    @{
        Name = 'APP_CONTEXT_RELOAD_KEY'
        Command = @'
vconftool get memory/appfw/app_context_db_change 2>&1 || true
'@
    }
)

foreach ($entry in $commands) {
    Invoke-SdbReadOnly -Name $entry.Name -Command $entry.Command
}

Write-Output '===== PROBE_DONE ====='
Write-Output 'MUTATION_ATTEMPTED=0'
Write-Output 'NEXT=CLASSIFY_OUTPUT_ONLY'
