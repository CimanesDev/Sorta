@echo off
rem Double-click to start Sorta, then use it at http://127.0.0.1:3000
cd /d "%~dp0"
if not exist node_modules (
  echo Installing for the first time, this takes a minute...
  call npm install || goto :error
)
echo Building...
call npm run build || goto :error
start "" http://127.0.0.1:3000
echo.
echo Sorta is running. Keep this window open; close it to stop.
call npm start
goto :eof

:error
echo.
echo Something went wrong. Is Node.js installed? (https://nodejs.org)
pause
