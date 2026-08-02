#!/bin/sh

# Mieru OpenWrt Client Automated Installation Script
# Target: OpenWrt 25.12.1 (mipsel_24kc, Xiaomi Mi Router 3G)

set -e

# DEFAULT CONFIG (will be auto-updated by publish.ps1)
GITHUB_USER="alexxttss"
GITHUB_REPO="mieru-openwrt"
GITHUB_BRANCH="main"

# Parse arguments
if [ "$#" -ge 1 ]; then
    INPUT_PATH="$1"
    if echo "$INPUT_PATH" | grep -q "/"; then
        GITHUB_USER=$(echo "$INPUT_PATH" | cut -d'/' -f1)
        GITHUB_REPO=$(echo "$INPUT_PATH" | cut -d'/' -f2)
    else
        GITHUB_USER="$INPUT_PATH"
    fi
fi

if [ "$#" -ge 2 ]; then
    GITHUB_REPO="$2"
fi

echo "========================================================="
echo " Installing Mieru Client on OpenWrt"
echo " Repository: github.com/$GITHUB_USER/$GITHUB_REPO"
echo " Branch:     $GITHUB_BRANCH"
echo "========================================================="

if [ "$GITHUB_USER" = "alexxttss" ] || [ "$GITHUB_REPO" = "mieru-openwrt" ]; then
    echo "ERROR: Please specify your GitHub username and repository name."
    echo "Usage: wget -qO- https://raw.githubusercontent.com/USER/REPO/main/install.sh | sh -s -- USER REPO"
    exit 1
fi

# Download URLs
RAW_URL="https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/${GITHUB_BRANCH}/packages"

APK_MIERU="mieru-3.34.1-r1.apk"
APK_LUCI="luci-app-mieru-0.260718.45081.apk"
APK_LANG="luci-i18n-mieru-ru-0.260718.45083.apk"

TMP_DIR="/tmp/mieru_install"
mkdir -p "$TMP_DIR"
cd "$TMP_DIR"

# Clean up any old files
rm -f "$APK_MIERU" "$APK_LUCI" "$APK_LANG"

echo "Downloading packages from GitHub..."
wget -q --no-check-certificate "${RAW_URL}/${APK_MIERU}" -O "$APK_MIERU" || { echo "Failed to download $APK_MIERU"; exit 1; }
wget -q --no-check-certificate "${RAW_URL}/${APK_LUCI}" -O "$APK_LUCI" || { echo "Failed to download $APK_LUCI"; exit 1; }
wget -q --no-check-certificate "${RAW_URL}/${APK_LANG}" -O "$APK_LANG" || { echo "Failed to download $APK_LANG"; exit 1; }

echo "Installing packages via apk manager..."
# apk add will automatically pull dependencies (like ucode, rpcd) from standard OpenWrt repos
apk add --allow-untrusted "$APK_MIERU" "$APK_LUCI" "$APK_LANG"

echo "Cleaning up temporary files..."
rm -f "$APK_MIERU" "$APK_LUCI" "$APK_LANG"
cd /
rm -rf "$TMP_DIR"

# Configure defaults if not set
if [ ! -f /etc/config/mieru ]; then
    echo "Creating default config..."
    mkdir -p /etc/config
    cat <<EOF > /etc/config/mieru
config mieru 'main'
	option enabled '0'
	option server '12.34.56.78'
	option port '2027'
	option username 'my_username'
	option password 'my_password'
	option protocol 'TCP'
	option socks5_port '1080'
	option mtu '1400'
	option log_level 'ERROR'
	option monitor_interval '10'
	option auto_backup '1'
	option auto_backup_limit '5'
EOF
fi

# Enable and start the service
echo "Enabling and starting Mieru service..."
/etc/init.d/mieru enable || true
/etc/init.d/mieru restart || true

echo "========================================================="
echo " Mieru Client successfully installed!"
echo " "
echo " Next steps:"
echo " 1. Configure the connection to your server in LuCI:"
echo "    Go to Web UI -> Services -> Mieru Client"
echo " 2. Or configure via UCI CLI:"
echo "    uci set mieru.main.server='YOUR_SERVER_IP'"
echo "    uci set mieru.main.port='YOUR_PORT'"
echo "    uci set mieru.main.username='YOUR_USERNAME'"
echo "    uci set mieru.main.password='YOUR_PASSWORD'"
echo "    uci set mieru.main.enabled='1'"
echo "    uci commit mieru"
echo "    /etc/init.d/mieru restart"
echo "========================================================="
