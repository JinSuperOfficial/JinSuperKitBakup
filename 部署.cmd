@echo off
rem ============================================================
rem  deploy entry point  (the file itself is named in Chinese:
rem  "bu shu .cmd" = "deploy.cmd"; that name lives in the
rem  filesystem only, never inside this file)
rem ------------------------------------------------------------
rem  The real implementation is build\deploy-cli.mjs. This file
rem  only does three things:
rem    1. cd to the script directory (works when double-clicked,
rem       pinned, or called from another folder)
rem    2. switch the console to UTF-8, otherwise Node's Chinese
rem       output comes out as mojibake
rem    3. forward the arguments
rem
rem  Commands live in build\deploy-cli.mjs, e.g. full / build / prep /
rem  rth / gh / check / serve / status / bakup, and "hwk" (enter
rem  today's homework; it shares the implementation with the console's
rem  homework panel). Run "deploy.cmd --help" for the current list.
rem
rem  "sync" is the cross-network channel (the school machine can only
rem  reach Gitee), implemented once in build\sync-cli.mjs and shared
rem  with console.cmd / console.sh:
rem    deploy.cmd sync check        probe the channel + show cloud version
rem    deploy.cmd sync push         dist -> GitHub Pages + Gitee mirror
rem    deploy.cmd sync pull         fetch the inbox the school uploaded
rem    deploy.cmd sync apply        land it in the repo (preview by default)
rem    deploy.cmd sync home         pull -> apply -> full, in one go
rem  Keep this list, deploy.sh, console.cmd and console.sh in step:
rem  the four entry points are one feature, so their docs move together.
rem
rem  KEEP THIS FILE PURE ASCII.
rem  cmd.exe decodes a batch file byte-by-byte using the *current*
rem  code page, and it re-reads the file by byte offset as it goes.
rem  Non-ASCII characters here survive the chcp switch badly: the
rem  offset drifts and cmd starts executing the middle of a line.
rem  (Seen for real: Chinese rem comments got run as commands.)
rem  Node reads UTF-8 fine, so all user-facing text lives there.
rem ============================================================

setlocal enableextensions
title JinSuper Deploy
cd /d "%~dp0"

rem Remember the old code page and restore it on the way out, so
rem running this does not leave the caller's terminal switched.
set "OLDCP="
for /f "tokens=2 delims=:" %%C in ('chcp') do set "OLDCP=%%C"
chcp 65001 >nul 2>nul

set "CLI=%~dp0build\deploy-cli.mjs"

where node >nul 2>nul
if errorlevel 1 goto :no_node

if not exist "%CLI%" goto :no_cli

node "%CLI%" %*
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

:no_cli
echo.
echo   [X] Missing file:
echo       %CLI%
echo.
set "CODE=1"
pause
goto :done

:done
if defined OLDCP chcp%OLDCP% >nul 2>nul
exit /b %CODE%
