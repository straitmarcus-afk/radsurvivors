// electron-builder afterPack hook (Linux).
// Puts a small launcher in front of the Electron binary so every launch, including from Steam,
// gets the flags the Steam Deck needs. Chromium picks its display backend before any app code
// runs, so these have to be real command-line flags.

const fs = require("node:fs");
const path = require("node:path");

const LAUNCHER = `#!/bin/sh
# Rad Survivors launcher.
# Steam injects its overlay and its own libraries into launched programs. Both can hang Chromium.
unset LD_PRELOAD
if [ -n "$LD_LIBRARY_PATH" ]; then
  CLEAN=""
  OLDIFS=$IFS; IFS=:
  for p in $LD_LIBRARY_PATH; do
    case "$p" in
      *steam-runtime*|*ubuntu12_32*|*ubuntu12_64*|*pinned_libs*|*steamrt*) ;;
      *) CLEAN="\${CLEAN:+$CLEAN:}$p" ;;
    esac
  done
  IFS=$OLDIFS
  export LD_LIBRARY_PATH="$CLEAN"
fi
HERE="$(dirname "$(readlink -f "$0")")"
# Gaming Mode (gamescope) breaks Chromium's Wayland backend, so force X11.
# The Chromium sandbox cannot work inside an AppImage.
exec "$HERE/rad-survivors-bin" --ozone-platform=x11 --no-sandbox "$@"
`;

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "linux") return;
  const exe = path.join(context.appOutDir, context.packager.executableName);
  const real = path.join(context.appOutDir, "rad-survivors-bin");
  fs.renameSync(exe, real);
  fs.writeFileSync(exe, LAUNCHER, { mode: 0o755 });
  console.log(`  • launcher installed in front of ${path.basename(real)}`);
};
