#!/usr/bin/env bash
# Assembles release/Virgil.app + release/Virgil-*.dmg manually.
# Why not electron-builder: the managed sandbox's file broker blocks its
# atomic-replace writes ("Brokered file token refused"). This script only uses
# native tools (cp / asar / PlistBuddy / codesign / hdiutil), which bypass that.
# Works identically in a normal terminal.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="Virgil"
VERSION="$(node -p "require('$ROOT/package.json').version")"
STAGE="$ROOT/.package-stage"
OUT="$ROOT/release/mac-arm64"
APP="$OUT/$APP_NAME.app"

echo "==> 1/6 准备目录"
rm -rf "$STAGE" "$APP" "$ROOT/release/$APP_NAME"*.dmg
mkdir -p "$OUT"

echo "==> 2/6 复制 Electron 运行时（约 250MB）"
cp -R "$ROOT/node_modules/electron/dist/Electron.app" "$APP"
# SwiftShader 是 GPU 不可用时用的软件渲染；macOS 基本都有 GPU，可移除省 ~16MB。
rm -f "$APP/Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libvk_swiftshader.dylib"

echo "==> 3/6 打包应用代码为 app.asar"
mkdir -p "$STAGE/app"
cp -R "$ROOT/out" "$STAGE/app/out"
cp "$ROOT/package.json" "$STAGE/app/package.json"
mkdir -p "$STAGE/app/node_modules"
cp -R "$ROOT/node_modules/ws" "$STAGE/app/node_modules/ws"
"$ROOT/node_modules/.bin/asar" pack "$STAGE/app" "$STAGE/app.asar"

echo "==> 4/6 注入资源（代码 + 声纹模型 + 图标）"
mkdir -p "$APP/Contents/Resources/vendor"
mkdir -p "$APP/Contents/Resources/node_modules"
cp "$STAGE/app.asar" "$APP/Contents/Resources/app.asar"
cp -R "$ROOT/vendor/asr" "$APP/Contents/Resources/vendor/asr"
cp "$ROOT/assets/icon.icns" "$APP/Contents/Resources/icon.icns"
# sherpa-onnx-node 的原生库不能进 asar，放真实的 node_modules
cp -R "$ROOT/node_modules/sherpa-onnx-node" "$APP/Contents/Resources/node_modules/"
cp -R "$ROOT/node_modules/sherpa-onnx-darwin-arm64" "$APP/Contents/Resources/node_modules/"
rm -f "$APP/Contents/Resources/electron.icns"

echo "==> 5/6 改写 Info.plist + 重签名（ad-hoc）"
PLIST="$APP/Contents/Info.plist"
PB=/usr/libexec/PlistBuddy
"$PB" -c "Set :CFBundleName $APP_NAME" "$PLIST"
"$PB" -c "Set :CFBundleDisplayName $APP_NAME" "$PLIST" 2>/dev/null \
  || "$PB" -c "Add :CFBundleDisplayName string $APP_NAME" "$PLIST"
"$PB" -c "Set :CFBundleExecutable $APP_NAME" "$PLIST"
"$PB" -c "Set :CFBundleIdentifier cn.virgil.copilot" "$PLIST"
# 不写这两条，App 对外显示的就是 Electron 自己的版本（44.5.1），而不是 Virgil 的版本。
"$PB" -c "Set :CFBundleShortVersionString $VERSION" "$PLIST"
"$PB" -c "Set :CFBundleVersion $VERSION" "$PLIST"
"$PB" -c "Set :CFBundleIconFile icon.icns" "$PLIST"
"$PB" -c "Add :NSMicrophoneUsageDescription string Virgil 需要使用麦克风来实时转录对话内容。" "$PLIST" 2>/dev/null \
  || "$PB" -c "Set :NSMicrophoneUsageDescription string Virgil 需要使用麦克风来实时转录对话内容。" "$PLIST"
mv "$APP/Contents/MacOS/Electron" "$APP/Contents/MacOS/$APP_NAME"
codesign --force --deep --sign - "$APP" 2>/dev/null

echo "==> 6/6 制作 DMG（Virgil.app + Applications 快捷方式）"
# 标准 macOS 安装盘：打开后把 Virgil 拖进 Applications 即完成安装。
# 所以镜像里除了 app 本身，还必须有一个指向 /Applications 的软链，
# 否则用户打开 dmg 只看到一个孤零零的图标，无处可拖。
DMG_STAGE="$STAGE/dmg"
mkdir -p "$DMG_STAGE"
cp -R "$APP" "$DMG_STAGE/"
ln -s /Applications "$DMG_STAGE/Applications"

# 先做成可写镜像，挂载后设置"打开时自动弹出 Finder 窗口"，再压成只读的 UDZO。
DMG_RW="$STAGE/$APP_NAME-rw.dmg"
hdiutil create -volname "$APP_NAME" -srcfolder "$DMG_STAGE" -ov -format UDRW -fs HFS+ "$DMG_RW" >/dev/null

MOUNT="/Volumes/$APP_NAME-dmgbuild"
hdiutil attach "$DMG_RW" -mountpoint "$MOUNT" -nobrowse >/dev/null
# 这一步只影响"打开时是否自动弹窗"，失败不影响安装功能。
bless --folder "$MOUNT" --openfolder "$MOUNT" 2>/dev/null || echo "  (bless 已跳过，不影响安装)"
hdiutil detach "$MOUNT" >/dev/null 2>&1 || true

hdiutil convert "$DMG_RW" -format UDZO -imagekey zlib-level=9 \
  -o "$ROOT/release/$APP_NAME-$VERSION-arm64.dmg" | tail -1

rm -rf "$STAGE"
echo
echo "完成："
ls -lh "$ROOT/release/" "$OUT/"
du -sh "$APP"
echo
echo "打开 dmg 后把 Virgil 拖进 Applications 即完成安装（镜像里已带 Applications 快捷方式）。"
echo "也可以直接用：$APP"
