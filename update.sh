#!/bin/sh

echo "========================================================="
echo " Updating Mieru Client on OpenWrt"
echo " Repository: github.com/alexxttss/mieru-openwrt"
echo " Branch:     main"
echo "========================================================="

GITHUB_USER="alexxttss"
GITHUB_REPO="mieru-openwrt"
GITHUB_BRANCH="main"

RAW_BASE="https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/${GITHUB_BRANCH}"

# 1. Verify /usr/bin/mieru core binary
if [ ! -f /usr/bin/mieru ]; then
    echo "Core Mieru binary not found. Installing from packages..."
    TMP_APK="/tmp/mieru_core.apk"
    wget -q --no-check-certificate "${RAW_BASE}/packages/mieru-3.34.1-r1.apk" -O "$TMP_APK" || {
        echo "Error: Failed to download core binary package."
        exit 1
    }
    apk add --allow-untrusted "$TMP_APK" 2>&1
    rm -f "$TMP_APK"
fi

echo "Downloading latest client files from GitHub..."
TMP_DIR="/tmp/mieru_update"
mkdir -p "$TMP_DIR"
mkdir -p /www/luci-static/resources/view
mkdir -p /usr/share/rpcd/ucode
mkdir -p /usr/share/rpcd/acl.d
mkdir -p /usr/share/luci/menu.d

# Download latest source files
wget -q --no-check-certificate "${RAW_BASE}/package/network/services/luci-app-mieru/htdocs/luci-static/resources/view/mieru.js" -O /www/luci-static/resources/view/mieru.js || { echo "Error downloading mieru.js"; exit 1; }
wget -q --no-check-certificate "${RAW_BASE}/package/network/services/luci-app-mieru/root/usr/share/rpcd/ucode/luci.mieru" -O /usr/share/rpcd/ucode/luci.mieru || { echo "Error downloading luci.mieru"; exit 1; }
wget -q --no-check-certificate "${RAW_BASE}/package/network/services/luci-app-mieru/root/usr/share/rpcd/acl.d/luci-app-mieru.json" -O /usr/share/rpcd/acl.d/luci-app-mieru.json || { echo "Error downloading luci-app-mieru.json"; exit 1; }
wget -q --no-check-certificate "${RAW_BASE}/package/network/services/luci-app-mieru/root/usr/share/luci/menu.d/luci-app-mieru.json" -O /usr/share/luci/menu.d/luci-app-mieru.json 2>/dev/null || true
wget -q --no-check-certificate "${RAW_BASE}/package/network/services/mieru/files/mieru.init" -O /etc/init.d/mieru || { echo "Error downloading mieru.init"; exit 1; }

# Fix permissions
chmod +x /etc/init.d/mieru
[ -f /usr/bin/mieru-monitor ] && chmod +x /usr/bin/mieru-monitor

echo "Clearing LuCI cache..."
rm -f /tmp/luci-indexcache.*
rm -rf /tmp/luci-modulecache/

echo "Reloading OpenWrt services..."
/etc/init.d/rpcd restart 2>/dev/null
/etc/init.d/uhttpd restart 2>/dev/null

echo "Restarting Mieru service..."
/etc/init.d/mieru restart 2>/dev/null

rm -rf "$TMP_DIR"

echo "========================================================="
echo " Mieru Client successfully updated to the latest version!"
echo " All buttons, diagnostic tools and logs are active."
echo " Configuration and backups preserved."
echo "========================================================="
