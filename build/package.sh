#!/bin/sh
# Build Note4Me.app into out/ (arm64), set the icon, and ad-hoc sign it.
set -e
cd "$(dirname "$0")/.."
npm run build:min
npx electron-packager . Note4Me --platform=darwin --arch=arm64 --out=out --overwrite \
  --app-bundle-id=dev.voidcl1ck.note4me \
  --ignore='^/out' --ignore='^/tools' --ignore='^/build' --ignore='^/\.gitignore' --ignore='^/README.md' --ignore='^/FORMAT.md'
APP=out/Note4Me-darwin-arm64/Note4Me.app
cp build/icon.icns "$APP/Contents/Resources/Note4Me.icns"
rm -f "$APP/Contents/Resources/electron.icns"
plutil -replace CFBundleIconFile -string Note4Me.icns "$APP/Contents/Info.plist"
codesign --force --deep --sign - "$APP"
echo "built $APP"
