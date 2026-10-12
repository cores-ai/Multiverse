@echo off
title Multiverse Autonomous Railway Daemon
cd /d "%~dp0"
echo ======================================================
echo   Launching Multiverse Autonomous Railway Daemon...
echo ======================================================
node auto_railway_daemon.js %*
pause
