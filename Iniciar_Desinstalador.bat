@echo off
title Queu Uninstaller
cd /d "%~dp0"

echo ========================================================
echo       Queu Uninstaller - Desinstalador em Fila
echo ========================================================
echo.

where npx >nul 2>nul
if %errorlevel% neq 0 (
    echo [AVISO] Node.js / npx nao encontrado no PATH do sistema.
    pause
    exit /b 1
)

echo Iniciando Queu Uninstaller...
call npx electron .
if %errorlevel% neq 0 (
    echo.
    echo [INFO] Abrindo em modo Janela Nativa Web...
    node server.js
)
