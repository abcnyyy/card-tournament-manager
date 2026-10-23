#!/usr/bin/env bash
# 下载安装 JDK 17（Microsoft OpenJDK，国内可达且速度较好）
BASE="C:/Users/31672/WorkBuddy/2026-10-18-18-57-25/sdk"
mkdir -p "$BASE"

if [ -f "$BASE/jdk17/bin/java.exe" ]; then
  echo "JDK17_ALREADY"
  "$BASE/jdk17/bin/java.exe" -version 2>&1 | head -3
  exit 0
fi

echo "downloading Microsoft OpenJDK 17 (~186MB) ..."
curl -L --retry 5 --retry-delay 3 -m 1800 -o "$BASE/jdk17.zip" \
  "https://aka.ms/download-jdk/microsoft-jdk-17.0.13-windows-x64.zip" || { echo "JDK_DOWNLOAD_FAIL"; exit 11; }

ls -la "$BASE/jdk17.zip"
rm -rf "$BASE/jdk17"
mkdir -p "$BASE/jdk17"
PY="C:/Users/31672/.workbuddy/binaries/python/versions/3.13.12/python.exe"
[ -f "$PY" ] || PY="C:/Users/31672/AppData/Local/Programs/Python/Python313/python.exe"
"$PY" "C:/Users/31672/WorkBuddy/2026-10-18-18-57-25/tools/unzip.py" "$BASE/jdk17.zip" "$BASE/jdk17" || { echo "JDK_EXTRACT_FAIL"; exit 12; }
rm -f "$BASE/jdk17.zip"

"$BASE/jdk17/bin/java.exe" -version 2>&1 | head -3
echo "JDK_DONE"
