@echo off
rem Swiss Knife launcher for Windows - forwards to swiss.ps1 without requiring
rem the user to loosen their PowerShell execution policy.
rem   swiss setup | up | down | status | doctor
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0swiss.ps1" %*
