# OpenWrt Пакет для Mieru Client

Данный репозиторий содержит полноценный пакет OpenWrt для клиента `mieru` (v3.34.1), оптимизированный для роутера Xiaomi Mi Router 3G (архитектура `mipsel_24kc`, ramips/mt7621, OpenWrt 25.12.1).

---

## 1. Структура проекта

Пакет имеет стандартную структуру OpenWrt:

- `Makefile` — инструкция сборки пакета, интегрированная с `golang-package.mk` для автоматической кросс-компиляции Go-кода.
- `files/mieru.config` — шаблон конфигурационного файла UCI `/etc/config/mieru`.
- `files/mieru.init` — скрипт инициализации `/etc/init.d/mieru` на базе `procd` с автоматической генерацией JSON-конфигурации через `jshn.sh`.
- `BUILD_LOG.md` — журнал сборки.
- `CHANGELOG.md` — история изменений пакета.

---

## 2. Инструкция по сборке

### Вариант А. Сборка локально на Linux (с использованием OpenWrt SDK)

Если у вас есть доступ к машине с Linux (Ubuntu/Debian), вы можете собрать пакет с помощью официального OpenWrt SDK:

1. **Скачайте SDK** для вашего релиза и архитектуры:
   ```bash
   wget https://downloads.openwrt.org/releases/25.12.1/targets/ramips/mt7621/openwrt-sdk-25.12.1-ramips-mt7621_gcc-13.3.0_musl.Linux-x86_64.tar.zst
   tar -xf openwrt-sdk-25.12.1-ramips-mt7621_*.tar.zst
   cd openwrt-sdk-25.12.1-ramips-mt7621_*
   ```

2. **Добавьте пакет** в структуру SDK:
   ```bash
   mkdir -p package/network/services/mieru
   # Скопируйте файлы пакета (Makefile, files/) в эту папку
   ```

3. **Обновите и установите фиды**:
   ```bash
   ./scripts/feeds update -a
   ./scripts/feeds install -a
   ```

4. **Скомпилируйте пакет**:
   ```bash
   make package/network/services/mieru/compile V=s
   ```

5. **Результат**: Готовый `.apk` файл появится в директории:
   `bin/packages/mipsel_24kc/base/mieru_3.34.1-1_mipsel_24kc.apk`

---

### Вариант Б. Автоматическая сборка в облаке через GitHub Actions (рекомендуется для Windows)

Вы можете опубликовать этот пакет в свой репозиторий на GitHub и собирать его с помощью GitHub Actions без локальной Linux-машины.

Создайте файл `.github/workflows/build.yml` в вашем репозитории:

```yaml
name: Build OpenWrt Package

on:
  push:
    branches: [ master, main ]
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Source
        uses: actions/checkout@v4

      - name: Setup OpenWrt SDK
        run: |
          sudo apt-get update
          sudo apt-get install -y build-essential clang flex bison g++ gawk gettext git libncurses5-dev libssl-dev python3-setuptools rsync unzip zlib1g-dev file wget
          wget https://downloads.openwrt.org/releases/25.12.1/targets/ramips/mt7621/openwrt-sdk-25.12.1-ramips-mt7621_gcc-13.3.0_musl.Linux-x86_64.tar.zst
          tar -xf openwrt-sdk-25.12.1-ramips-mt7621_*.tar.zst
          mv openwrt-sdk-25.12.1-ramips-mt7621_* sdk

      - name: Copy Package Source
        run: |
          mkdir -p sdk/package/network/services/mieru
          cp -r package/network/services/mieru/* sdk/package/network/services/mieru/

      - name: Install Feeds Dependencies
        run: |
          cd sdk
          ./scripts/feeds update -a
          ./scripts/feeds install -a

      - name: Compile Package
        run: |
          cd sdk
          make defconfig
          make package/network/services/mieru/compile V=s

      - name: Upload Artifact
        uses: actions/upload-artifact@v4
        with:
          name: mieru-openwrt-apk
          path: sdk/bin/packages/mipsel_24kc/base/mieru_*.apk
```

После пуша коммита GitHub скомпилирует пакет в облаке и предоставит ссылку для скачивания готового `.apk`.

---

## 3. Инструкция по установке

Перенесите скомпилированный `.apk` файл на роутер (например, с помощью утилиты `scp` или через веб-интерфейс LuCI) и выполните установку:

```bash
# Установка пакета (поскольку он собран самостоятельно, используйте --allow-untrusted)
apk add --allow-untrusted ./mieru_3.34.1-1_mipsel_24kc.apk
```

После этого в системе будут автоматически созданы:
- Исполняемый файл: `/usr/bin/mieru`
- Конфигурационный файл UCI: `/etc/config/mieru`
- Скрипт инициализации: `/etc/init.d/mieru`

---

## 4. Настройка (UCI Configuration)

Откройте файл `/etc/config/mieru` или используйте CLI-команды `uci` для настройки подключения к вашему серверу:

```bash
# Включение сервиса
uci set mieru.main.enabled='1'

# Параметры подключения к серверу mita
uci set mieru.main.server='YOUR_VPS_IP'
uci set mieru.main.port='YOUR_PORT'
uci set mieru.main.username='YOUR_USERNAME'
uci set mieru.main.password='YOUR_PASSWORD'
uci set mieru.main.protocol='TCP' # Или 'UDP'

# Локальные порты
uci set mieru.main.socks5_port='1080'
uci set mieru.main.mtu='1400'
uci set mieru.main.log_level='ERROR'

# Применение конфигурации
uci commit mieru
/etc/init.d/mieru restart
```

Скрипт `/etc/init.d/mieru` автоматически прочитает эти опции и сформирует правильный JSON-файл в `/var/etc/mieru_client_config.json`, после чего запустит демон.

---

## 5. Управление сервисом (Lifecycle)

Управление осуществляется с помощью стандартных команд `procd`:

- **Запуск сервиса**: `/etc/init.d/mieru start`
- **Остановка сервиса**: `/etc/init.d/mieru stop`
- **Перезапуск**: `/etc/init.d/mieru restart`
- **Просмотр статуса**: `/etc/init.d/mieru status`
- **Перезапуск после изменения настроек**: `/etc/init.d/mieru reload`
- **Включение автозапуска**: `/etc/init.d/mieru enable`
- **Отключение автозапуска**: `/etc/init.d/mieru disable`

---

## 6. Инструкция по обновлению

Для обновления версии Mieru:
1. Измените значение переменной `PKG_VERSION` в `Makefile` на новую версию.
2. Скомпилируйте пакет заново.
3. Установите обновленный файл на роутер командой:
   ```bash
   apk add --allow-untrusted --upgrade ./mieru_NEW_VERSION_mipsel_24kc.apk
   ```
   Конфигурационные файлы в `/etc/config/mieru` при этом будут сохранены.
