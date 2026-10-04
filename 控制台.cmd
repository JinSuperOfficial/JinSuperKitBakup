@echo off
rem ============================================================
rem  local publishing console launcher
rem  (the file itself is named in Chinese: "kong zhi tai .cmd"
rem   = "console.cmd"; that name lives in the filesystem only)
rem ------------------------------------------------------------
rem  Starts console\server.mjs on 127.0.0.1:8791 and opens the
rem  browser. The server prints the URL again, so a failed
rem  auto-open is never a dead end.
rem
rem  KEEP THIS FILE PURE ASCII.
rem  cmd.exe decodes a batch file byte-by-byte with the current
rem  code page and re-reads it by byte offset; non-ASCII here
rem  survives the chcp switch badly and cmd ends up executing
rem  the middle of a line. All user-facing text lives in Node.
rem
rem  This tool is LOCAL ONLY. Nothing it does ends up in dist\:
rem  prep-deploy.mjs never mirrors the console\ folder.
rem ============================================================

setlocal enableextensions
title JinSuper Console
cd /d "%~dp0"

set "OLDCP="
for /f "tokens=2 delims=:" %%C in ('chcp') do set "OLDCP=%%C"
chcp 65001 >nul 2>nul

set "SERVER=%~dp0console\server.mjs"

where node >nul 2>nul
if errorlevel 1 goto :no_node

if not exist "%SERVER%" goto :no_server

rem  --port N can be forwarded:  console.cmd --port 8792
node "%SERVER%" %*
set "CODE=%ERRORLEVEL%"
goto :done

:no_node
echo.
echo   [X] Node.js not found in PATH.
echo.
echo       Install the LTS build from https://nodejs.org/
echo       then open a new window and run this again.
echo.
set "CODE=1"
pause
goto :done

:no_server
echo.
echo   [X] Missing file:
echo       %SERVER%
echo.
set "CODE=1"
pause
goto :done

:done
if defined OLDCP chcp%OLDCP% >nul 2>nul
exit /b %CODE%
