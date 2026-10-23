#!/usr/bin/env bash
# 环境准备：JDK 17 + Android SDK（cmdline-tools / platform / build-tools）
# 幂等：已存在则跳过
BASE="C:/Users/31672/WorkBuddy/2026-10-18-18-57-25/sdk"
mkdir -p "$BASE"

echo "===== [1/4] JDK 17 ====="
if [ ! -f "$BASE/jdk17/bin/java.exe" ]; then
  echo "downloading JDK17 (Temurin 17, ~190MB) ..."
  curl -L --retry 3 --retry-delay 5 -m 1800 -o "$BASE/jdk17.zip" \
    "https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse" || { echo "JDK_DOWNLOAD_FAIL"; exit 11; }
  rm -rf "$BASE/jdk17"
  mkdir -p "$BASE/jdk17"
  tar -xf "$BASE/jdk17.zip" -C "$BASE/jdk17" --strip-components=1 || { echo "JDK_EXTRACT_FAIL"; exit 12; }
  rm -f "$BASE/jdk17.zip"
else
  echo "JDK17 already present"
fi
"$BASE/jdk17/bin/java.exe" -version 2>&1 | head -3

export JAVA_HOME="C:\\Users\\31672\\WorkBuddy\\2026-10-18-18-57-25\\sdk\\jdk17"
export PATH="$JAVA_HOME/bin:$PATH"

echo "===== [2/4] Android cmdline-tools ====="
if [ ! -f "$BASE/cmdline-tools/latest/bin/sdkmanager.bat" ]; then
  echo "downloading cmdline-tools (~130MB) ..."
  curl -L --retry 3 --retry-delay 5 -m 1800 -o "$BASE/cmdtools.zip" \
    "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip" || { echo "CMDTOOLS_FAIL"; exit 21; }
  rm -rf "$BASE/cmdline-tools"
  mkdir -p "$BASE/cmdline-tools"
  tar -xf "$BASE/cmdtools.zip" -C "$BASE/cmdline-tools" || { echo "CMDTOOLS_EXTRACT_FAIL"; exit 22; }
  rm -f "$BASE/cmdtools.zip"
  if [ -d "$BASE/cmdline-tools/cmdline-tools" ] && [ ! -d "$BASE/cmdline-tools/latest" ]; then
    mv "$BASE/cmdline-tools/cmdline-tools" "$BASE/cmdline-tools/latest"
  fi
else
  echo "cmdline-tools already present"
fi
ls "$BASE/cmdline-tools/latest/bin"

echo "===== [3/4] sdkmanager: platform-tools / platform-34 / build-tools-34 ====="
ANDROID_SDK_ROOT_WIN="C:\\Users\\31672\\WorkBuddy\\2026-10-18-18-57-25\\sdk\\android"
ANDROID_SDK_ROOT_POSIX="$BASE/android"
mkdir -p "$ANDROID_SDK_ROOT_POSIX/licenses"
# 预先写入许可 hash（标准 Android SDK 许可）
cat > "$ANDROID_SDK_ROOT_POSIX/licenses/android-sdk-license" <<'EOF'
24333f8a63b6825ea9c5514f83c2829b004d1fee
8933bad161af4178b1185d1a37fbf41ea5269c55
d56f5187479451eabf01fb78af6dfcb131a6481e
EOF
cat > "$ANDROID_SDK_ROOT_POSIX/licenses/android-sdk-preview-license" <<'EOF'
84831b9409646a918e30573bab4c9c91346d8abd
EOF
echo "accepting licenses ..."
yes 2>/dev/null | cmd //c "set JAVA_HOME=$JAVA_HOME && \"$BASE\\cmdline-tools\\latest\\bin\\sdkmanager.bat\" --sdk_root=$ANDROID_SDK_ROOT_WIN --licenses" 2>&1 | tail -5

echo "installing packages ..."
yes 2>/dev/null | cmd //c "set JAVA_HOME=$JAVA_HOME && \"$BASE\\cmdline-tools\\latest\\bin\\sdkmanager.bat\" --sdk_root=$ANDROID_SDK_ROOT_WIN \"platform-tools\" \"platforms;android-34\" \"build-tools;34.0.0\"" 2>&1 | tail -20

echo "===== [4/4] verify ====="
ls "$ANDROID_SDK_ROOT_POSIX"
echo "ENV_SETUP_DONE"
