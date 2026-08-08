#!/bin/sh

echo "========================================================="
echo " Uninstalling Mieru Client from OpenWrt"
echo "========================================================="

echo "Stopping and disabling Mieru service..."
/etc/init.d/mieru stop 2>/dev/null
/etc/init.d/mieru disable 2>/dev/null

echo "Removing Mieru packages via apk manager..."
apk del luci-i18n-mieru-ru luci-app-mieru mieru 2>&1

echo "Cleaning up remaining configurations, logs, and backup files..."
rm -rf /etc/config/mieru \
       /var/etc/mieru_* \
       /tmp/mieru* \
       /root/.config/mieru \
       /etc/mieru_backups \
       /usr/bin/mieru-monitor \
       /usr/share/rpcd/ucode/luci.mieru \
       /usr/share/luci/menu.d/luci-app-mieru.json \
       /usr/share/rpcd/acl.d/luci-app-mieru.json \
       /www/luci-static/resources/view/mieru.js

echo "Reloading OpenWrt RPCD and uHTTPd web services..."
/etc/init.d/rpcd restart 2>/dev/null
/etc/init.d/uhttpd restart 2>/dev/null

echo "========================================================="
echo " Mieru Client has been completely uninstalled."
echo "========================================================="
