#!/usr/bin/env bash
# 用纯 Windows 路径调用 sdkmanager 安装 Android 组件
JDK_WIN='C:\Users\31672\WorkBuddy\2026-10-18-18-57-25\sdk\jdk17'
SDK_WIN='C:\Users\31672\WorkBuddy\2026-10-18-18-57-25\sdk\android'
SDKMGR='C:\Users\31672\WorkBuddy\2026-10-18-18-57-25\sdk\cmdline-tools\latest\bin\sdkmanager.bat'

echo "--- java version ---"
cmd //c "set JAVA_HOME=$JDK_WIN&& \"$JDK_WIN\\bin\\java.exe\" -version" 2>&1 | head -4

echo "--- sdkmanager --version ---"
cmd //c "set JAVA_HOME=$JDK_WIN&& \"$SDKMGR\" --version" 2>&1 | tail -5

echo "--- install packages ---"
cmd //c "set JAVA_HOME=$JDK_WIN&& \"$SDKMGR\" --sdk_root=$SDK_WIN \"platform-tools\" \"platforms;android-34\" \"build-tools;34.0.0\"" 2>&1 | tail -20

echo "--- verify ---"
ls "C:/Users/31672/WorkBuddy/2026-10-18-18-57-25/sdk/android"
echo "DONE"
