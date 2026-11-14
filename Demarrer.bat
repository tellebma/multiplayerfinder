@echo off
cd /d "%~dp0"
echo JVFinder - http://localhost:8765
echo Gardez cette fenetre ouverte. Ctrl+C pour arreter.
start "" "http://localhost:8765"
node dev-server.mjs
pause
