@echo off
set JAVA_HOME=C:\Users\31672\WorkBuddy\2026-10-18-18-57-25\sdk\jdk17
set ANDROID_SDK_ROOT=C:\Users\31672\WorkBuddy\2026-10-18-18-57-25\sdk\android
set ANDROID_HOME=%ANDROID_SDK_ROOT%
set PATH=%JAVA_HOME%\bin;%PATH%

echo === SDKMANAGER START ===
call "C:\Users\31672\WorkBuddy\2026-10-18-18-57-25\sdk\cmdline-tools\latest\bin\sdkmanager.bat" --version
echo === INSTALL ===
call "C:\Users\31672\WorkBuddy\2026-10-18-18-57-25\sdk\cmdline-tools\latest\bin\sdkmanager.bat" --sdk_root=%ANDROID_SDK_ROOT% "platform-tools" "platforms;android-34" "build-tools;34.0.0"
echo === EXIT %ERRORLEVEL% ===
