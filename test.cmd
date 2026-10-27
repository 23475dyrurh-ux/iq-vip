@echo off
echo =======================================================
echo  Running IQ VIP Integration & Security Test Suite...
echo =======================================================
"%~dp0node.cmd" "%~dp0tests\api_tests.js"
pause
