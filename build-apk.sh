#!/bin/bash
# ============================================================
# TreeUi — Full APK Build Script
# ============================================================
# 
# This script handles the entire build process:
#   1. Installs npm dependencies (Capacitor)
#   2. Prepares the www/ directory
#   3. Adds Android platform (if not already added)
#   4. Syncs web files to Android project
#   5. Patches Android config for permissions (camera, mic, internet)
#   6. Builds the debug APK
#
# REQUIREMENTS:
#   - Node.js 16+ and npm
#   - Java 17+ (JDK)
#   - Android SDK (or Android Studio installed)
#   - ANDROID_HOME or ANDROID_SDK_ROOT environment variable set
#
# USAGE:
#   chmod +x build-apk.sh
#   ./build-apk.sh
#
# ============================================================

set -e

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║          🌳 TreeUi — APK Builder v1.0           ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check prerequisites
echo -e "${YELLOW}[1/6]${NC} Checking prerequisites..."

check_cmd() {
  if ! command -v "$1" &> /dev/null; then
    echo -e "${RED}❌ $1 is not installed. Please install it first.${NC}"
    exit 1
  fi
  echo "  ✅ $1 found"
}

check_cmd node
check_cmd npm
check_cmd java

# Check ANDROID_HOME
if [ -z "$ANDROID_HOME" ] && [ -z "$ANDROID_SDK_ROOT" ]; then
  # Try common locations
  if [ -d "$HOME/Android/Sdk" ]; then
    export ANDROID_HOME="$HOME/Android/Sdk"
  elif [ -d "$HOME/Library/Android/sdk" ]; then
    export ANDROID_HOME="$HOME/Library/Android/sdk"
  elif [ -d "/usr/local/lib/android/sdk" ]; then
    export ANDROID_HOME="/usr/local/lib/android/sdk"
  else
    echo -e "${RED}❌ ANDROID_HOME is not set and Android SDK not found.${NC}"
    echo "   Please install Android Studio or set ANDROID_HOME manually."
    echo "   Example: export ANDROID_HOME=\$HOME/Android/Sdk"
    exit 1
  fi
  echo "  ✅ ANDROID_HOME auto-detected: $ANDROID_HOME"
else
  ANDROID_HOME="${ANDROID_HOME:-$ANDROID_SDK_ROOT}"
  echo "  ✅ ANDROID_HOME: $ANDROID_HOME"
fi

export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"

# Step 2: Install dependencies
echo ""
echo -e "${YELLOW}[2/6]${NC} Installing npm dependencies..."
npm install --legacy-peer-deps 2>&1 | tail -5

# Step 3: Prepare www/
echo ""
echo -e "${YELLOW}[3/6]${NC} Preparing www/ directory..."
node scripts/prepare-www.js

# Step 4: Add Android platform if not present
echo ""
echo -e "${YELLOW}[4/6]${NC} Setting up Android platform..."
if [ ! -d "android" ]; then
  npx cap add android
  echo "  ✅ Android platform added"
else
  echo "  ✅ Android platform already exists"
fi

# Step 5: Sync web assets
echo ""
echo -e "${YELLOW}[5/6]${NC} Syncing web assets to Android..."
npx cap sync android

# Patch AndroidManifest.xml for permissions
MANIFEST="android/app/src/main/AndroidManifest.xml"
if [ -f "$MANIFEST" ]; then
  # Add necessary permissions if not present
  if ! grep -q "RECORD_AUDIO" "$MANIFEST"; then
    sed -i 's|<application|<uses-permission android:name="android.permission.RECORD_AUDIO"/>\n    <uses-permission android:name="android.permission.CAMERA"/>\n    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE"/>\n    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE"/>\n    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS"/>\n    \n    <application|' "$MANIFEST"
    echo "  ✅ Added audio/camera/storage permissions"
  fi
fi

# Step 6: Build APK
echo ""
echo -e "${YELLOW}[6/6]${NC} Building APK..."
cd android
./gradlew assembleDebug --no-daemon 2>&1 | tail -20
cd ..

# Find the APK
APK_PATH="android/app/build/outputs/apk/debug/app-debug.apk"
if [ -f "$APK_PATH" ]; then
  APK_SIZE=$(du -h "$APK_PATH" | cut -f1)
  echo ""
  echo "╔══════════════════════════════════════════════════╗"
  echo "║              ✅ BUILD SUCCESSFUL!                ║"
  echo "╚══════════════════════════════════════════════════╝"
  echo ""
  echo -e "  📱 APK: ${GREEN}$APK_PATH${NC}"
  echo -e "  📦 Size: ${GREEN}$APK_SIZE${NC}"
  echo ""
  echo "  📲 Install on device:"
  echo "     adb install $APK_PATH"
  echo ""
  echo "  📤 Or copy the APK to your phone and install manually."
  echo ""
else
  echo ""
  echo -e "${RED}❌ Build failed. Check the Gradle output above.${NC}"
  exit 1
fi
