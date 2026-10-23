@echo off
setlocal EnableExtensions

rem Save this file in the asteroids-bootdev repository root.
rem One launcher, two visible server consoles. Does not deploy anything.
set "ROOT=%~dp0"
set "GAME=%ROOT%phaser-asteroids"
set "SERVER=%GAME%\server"
set "LAN_IP=192.168.7.198"
set "WRANGLER_SEND_METRICS=false"

if not exist "%GAME%\package.json" (
    echo ERROR: Cannot find phaser-asteroids\package.json.
    echo Put this file in your asteroids-bootdev repository root.
    pause
    exit /b 1
)
if not exist "%SERVER%\package.json" (
    echo ERROR: Cannot find phaser-asteroids\server\package.json.
    pause
    exit /b 1
)

rem Refuse to start a second Vite instance; avoid automatic port hopping.
powershell.exe -NoProfile -Command "if (Get-NetTCPConnection -State Listen -LocalPort 5173 -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }" >nul 2>&1
if errorlevel 1 (
    echo Port 5173 is already in use. The game may already be running.
    echo Open http://%LAN_IP%:5173/ or close the old LAN server windows first.
    echo No new processes were started.
    pause
    exit /b 1
)

echo.
echo === Asteroids LAN: applying local D1 migrations ===
echo This keeps your existing local leaderboard scores.
pushd "%SERVER%"
call npm.cmd run migrate:lan
set "MIGRATE_RESULT=%ERRORLEVEL%"
popd
if not "%MIGRATE_RESULT%"=="0" (
    echo.
    echo ERROR: Local D1 migration failed ^(code %MIGRATE_RESULT%^).
    echo No servers were started. Check npm and the LAN setup guide.
    pause
    exit /b %MIGRATE_RESULT%
)

echo.
echo === Starting local Worker and game server ===
start "Asteroids LAN - Worker/D1" /D "%SERVER%" cmd.exe /k "npm.cmd run dev:lan"
timeout /t 3 /nobreak >nul
start "Asteroids LAN - Game/Vite" /D "%GAME%" cmd.exe /k "npm.cmd run dev:lan -- --host %LAN_IP%"

echo.
echo Phone URL: http://%LAN_IP%:5173/
echo.
echo Leave BOTH server windows open while playing.
echo Close those two windows when you are finished.
echo This launcher does not change the firewall, production, or your scores.
echo.
pause
endlocal
