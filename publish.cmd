@echo off
title IQ VIP Platform - Public Cloudflare Tunnel
echo =======================================================
echo  Launching IQ VIP Platform with Public Cloudflare URL
echo =======================================================
cd /d "%~dp0"

echo 1. Starting Backend Server...
start "" node server/index.js

echo 2. Launching Public HTTPS Tunnel...
..\cloudflared.exe tunnel --url http://127.0.0.1:3000

pause
