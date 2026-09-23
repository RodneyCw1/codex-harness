@echo off
setlocal
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 is required. Install Node.js 24 and reopen the terminal. 1>&2
  exit /b 2
)
node "%~dp0dist\harness.mjs" %*
exit /b %errorlevel%
