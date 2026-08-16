#!/bin/sh

echo "========================================================="
echo " Updating Mieru Client on OpenWrt"
echo " Repository: github.com/alexxttss/mieru-openwrt"
echo " Branch:     main"
echo "========================================================="

GITHUB_USER="alexxttss"
GITHUB_REPO="mieru-openwrt"
GITHUB_BRANCH="main"

RAW_URL="https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/${GITHUB_BRANCH}/packages"

# Package names
APK_MIERU="mieru-3.34.1-r1.apk"
APK_LUCI="luci-app-mieru-0.260816.26603.apk"
APK_LANG="luci-i18n-mieru-ru-0.260816.26603.apk"

TMP_DIR="/tmp/mieru_update"
mkdir -p "$TMP_DIR"
cd "$TMP_DIR" || exit 1

echo "Downloading latest packages from GitHub..."
wget -q "${RAW_URL}/${APK_MIERU}" -O "$APK_MIERU" || { echo "Error downloading $APK_MIERU"; exit 1; }
wget -q "${RAW_URL}/${APK_LUCI}" -O "$APK_LUCI" || { echo "Error downloading $APK_LUCI"; exit 1; }
wget -q "${RAW_URL}/${APK_LANG}" -O "$APK_LANG" || { echo "Error downloading $APK_LANG"; exit 1; }

echo "Upgrading packages via apk manager..."
apk add --upgrade ./*.apk 2>&1

echo "Cleaning up temporary files..."
cd /tmp && rm -rf "$TMP_DIR"

echo "Reloading OpenWrt services..."
/etc/init.d/rpcd restart 2>/dev/null
/etc/init.d/uhttpd restart 2>/dev/null

echo "Restarting Mieru service..."
/etc/init.d/mieru restart 2>/dev/null

echo "========================================================="
echo " Mieru Client successfully updated!"
echo " Configuration and backups preserved."
echo "========================================================="
