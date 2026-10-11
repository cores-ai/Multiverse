@echo off
title Firefox Spoofed Session
cd /d "%~dp0"
echo ======================================================
echo   Launching Firefox with Hardware & Fingerprint Spoofing...
echo ======================================================
node launch_firefox_session.js %*
pause
