@echo off
setlocal
REM Copy outside the project, then replace the following paths.
REM Codex may add process-only runtime variables after inspecting the project.
set "HARNESS_EXECUTOR=C:\Tools\codex-harness-executor-v1.2\harness.cmd"
set "HARNESS_CONFIG=%~dp0harness.config.yaml"
call "%HARNESS_EXECUTOR%" %* --config "%HARNESS_CONFIG%"
exit /b %errorlevel%
