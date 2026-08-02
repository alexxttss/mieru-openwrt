#
# Copyright (C) 2026 OpenWrt.org
#
# This is free software, licensed under the GNU General Public License v3.
# See /LICENSE for more information.
#

include $(TOPDIR)/rules.mk

PKG_NAME:=mieru
PKG_VERSION:=3.34.1
PKG_RELEASE:=1

PKG_SOURCE_PROTO:=git
PKG_SOURCE_URL:=https://github.com/enfein/mieru.git
PKG_SOURCE_VERSION:=v$(PKG_VERSION)
PKG_MIRROR_HASH:=skip

PKG_LICENSE:=GPL-3.0-or-later
PKG_LICENSE_FILES:=LICENSE

PKG_BUILD_DEPENDS:=golang/host
PKG_USE_MIPS16:=0

TARGET_CFLAGS += -mno-mips16
TARGET_CXXFLAGS += -mno-mips16

GO_PKG:=github.com/enfein/mieru/v3
GO_PKG_BUILD_PKG:=github.com/enfein/mieru/v3/cmd/mieru
GO_PKG_LDFLAGS:=-s -w

include $(INCLUDE_DIR)/package.mk
include $(TOPDIR)/feeds/packages/lang/golang/golang-package.mk

define Package/mieru
  SECTION:=net
  CATEGORY:=Network
  SUBMENU:=Web Servers/Proxies
  TITLE:=Mieru proxy client
  URL:=https://github.com/enfein/mieru
  DEPENDS:=$(GO_ARCH_DEPENDS)
endef

define Package/mieru/description
  Mieru is a secure, hard to classify, hard to probe, TCP or UDP protocol-based socks5 / HTTP / HTTPS network proxy client.
endef

define Package/mieru/install
	$(call GoPackage/Package/Install/Bin,$(1))
	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./files/mieru.config $(1)/etc/config/mieru
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/mieru.init $(1)/etc/init.d/mieru
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) ./files/mieru-monitor $(1)/usr/bin/mieru-monitor
endef

$(eval $(call GoBinPackage,mieru))
$(eval $(call BuildPackage,mieru))
