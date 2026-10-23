#!/usr/bin/env bash
# 下载 Android cmdline-tools，并用 JDK17 安装 platform / build-tools
BASE="C:/Users/31672/WorkBuddy/2026-10-18-18-57-25/sdk"
JDK_WIN="C:\\Users\\31672\\WorkBuddy\\2026-10-18-18-57-25\\sdk\\jdk17"
SDK_WIN="C:\\Users\\31672\\WorkBuddy\\2026-10-18-18-57-25\\sdk\\android"
mkdir -p "$BASE"

echo "===== [1/3] download cmdline-tools (~153MB) ====="
if [ ! -f "$BASE/cmdline-tools/latest/bin/sdkmanager.bat" ]; then
  curl -L --retry 5 --retry-delay 3 -m 1800 -o "$BASE/cmdtools.zip" \
    "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip" || { echo "CMDTOOLS_FAIL"; exit 21; }
  rm -rf "$BASE/cmdline-tools"
  mkdir -p "$BASE/cmdline-tools/latest"
  PY="C:/Users/31672/.workbuddy/binaries/python/versions/3.13.12/python.exe"
  [ -f "$PY" ] || PY="C:/Users/31672/AppData/Local/Programs/Python/Python313/python.exe"
  "$PY" "C:/Users/31672/WorkBuddy/2026-10-18-18-57-25/tools/unzip.py" "$BASE/cmdtools.zip" "$BASE/cmdline-tools/latest" || { echo "CMDTOOLS_EXTRACT_FAIL"; exit 22; }
  rm -f "$BASE/cmdtools.zip"
fi
ls "$BASE/cmdline-tools/latest/bin"

echo "===== [2/3] prepare licenses ====="
mkdir -p "$BASE/android/licenses"
cat > "$BASE/android/licenses/android-sdk-license" <<'EOF'
24333f8a63b6825ea9c5514f83c2829b004d1fee
8933bad161af4178b1185d1a37fbf41ea5269c55
d56f5187479451eabf01fb78af6dfcb131a6481e
EOF
cat > "$BASE/android/licenses/android-sdk-preview-license" <<'EOF'
84831b9409646a918e30573bab4c9c91346d8abd
EOF

echo "===== [3/3] sdkmanager install ====="
if [ ! -f "$JDK_WIN\\bin\\java.exe" ] && [ ! -f "$BASE/jdk17/bin/java.exe" ]; then
  echo "JDK_MISSING"; exit 31;
fi

yes 2>/dev/null | cmd //c "set JAVA_HOME=$JDK_WIN && \"$BASE\\cmdline-tools\\latest\\bin\\sdkmanager.bat\" --sdk_root=$SDK_WIN --licenses" 2>&1 | tail -6

yes 2>/dev/null | cmd //c "set JAVA_HOME=$JDK_WIN && \"$BASE\\cmdline-tools\\latest\\bin\\sdkmanager.bat\" --sdk_root=$SDK_WIN \"platform-tools\" \"platforms;android-34\" \"build-tools;34.0.0\"" 2>&1 | tail -25

echo "===== verify ====="
ls "$BASE/android"
echo "ANDROID_DONE"
