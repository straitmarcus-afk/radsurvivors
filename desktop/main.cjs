// Steam Deck / desktop wrapper for Rad Survivors.
// Reads Fallout 2 files straight from the player's install and remembers the folder.

const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

// Gaming Mode on the Deck runs under gamescope, where Wayland fails for Chromium apps. Force X11.
app.commandLine.appendSwitch("ozone-platform", "x11");
// Let the soundtrack start without a click.
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

const settingsFile = () => path.join(app.getPath("userData"), "settings.json");

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), "utf8"));
  } catch {
    return {};
  }
}

function saveSettings(s) {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2));
  } catch (e) {
    console.error("Could not save settings:", e);
  }
}

/** Case-insensitive lookup of a child entry (Linux file systems are case-sensitive, Fallout files vary). */
function findChild(dir, name) {
  try {
    const hit = fs.readdirSync(dir).find((e) => e.toLowerCase() === name.toLowerCase());
    return hit ? path.join(dir, hit) : null;
  } catch {
    return null;
  }
}

function looksLikeFallout2(dir) {
  return !!dir && !!findChild(dir, "master.dat") && !!findChild(dir, "critter.dat");
}

/** Steam library folders listed in Steam's libraryfolders.vdf, so installs on any drive are found. */
function steamLibraries(steamRoots) {
  const libs = [];
  for (const root of steamRoots) {
    for (const vdf of [path.join(root, "steamapps", "libraryfolders.vdf"), path.join(root, "config", "libraryfolders.vdf")]) {
      try {
        const text = fs.readFileSync(vdf, "utf8");
        for (const m of text.matchAll(/"path"\s+"([^"]+)"/g)) libs.push(m[1].replace(/\\\\/g, "\\"));
      } catch {
        /* no file here */
      }
    }
  }
  return libs;
}

/** Common install spots on Linux (including the Deck's SD card), Windows and Mac, plus every Steam library. */
function guessFolders() {
  const home = os.homedir();
  const steamRoots = [
    path.join(home, ".local/share/Steam"),
    path.join(home, ".steam/steam"),
    path.join(home, ".var/app/com.valvesoftware.Steam/.local/share/Steam"),
    "C:\\Program Files (x86)\\Steam",
    "C:\\Program Files\\Steam",
    path.join(home, "Library/Application Support/Steam"),
  ];
  const out = [
    ...steamRoots.map((r) => path.join(r, "steamapps", "common", "Fallout 2")),
    ...steamLibraries(steamRoots).map((l) => path.join(l, "steamapps", "common", "Fallout 2")),
    "C:\\GOG Games\\Fallout 2",
    "C:\\Program Files (x86)\\GOG Galaxy\\Games\\Fallout 2",
    "C:\\Program Files (x86)\\GOG.com\\Fallout 2",
    path.join(home, "GOG Games", "Fallout 2"),
  ];
  for (const media of ["/run/media", path.join("/run/media", os.userInfo().username)]) {
    try {
      for (const card of fs.readdirSync(media)) {
        out.push(path.join(media, card, "steamapps/common/Fallout 2"));
        out.push(path.join(media, card, "SteamLibrary/steamapps/common/Fallout 2"));
      }
    } catch {
      /* no removable media */
    }
  }
  return [...new Set(out)];
}

let allowedRoot = null; // reads are limited to the chosen Fallout 2 folder

// The personal build carries a trimmed copy of the owner's Fallout 2 files (scripts/make-personal-pack.mjs).
function bundledFolder() {
  const dir = path.join(process.resourcesPath || "", "personal", "Fallout 2");
  return looksLikeFallout2(dir) ? dir : null;
}

ipcMain.handle("get-folder", () => {
  const saved = loadSettings().folder;
  const found = looksLikeFallout2(saved) ? saved : guessFolders().find(looksLikeFallout2) ?? null;
  const folder = found ?? bundledFolder();
  if (folder) {
    allowedRoot = path.resolve(folder);
    // The bundled path changes on every AppImage launch, so only real installs are remembered.
    if (found && found !== saved) saveSettings({ ...loadSettings(), folder: found });
  }
  return folder;
});

ipcMain.handle("pick-folder", async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const res = await dialog.showOpenDialog(win, {
    title: "Choose your Fallout 2 folder (the one with master.dat in it)",
    properties: ["openDirectory"],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  const folder = res.filePaths[0];
  allowedRoot = path.resolve(folder);
  saveSettings({ ...loadSettings(), folder });
  return folder;
});

ipcMain.handle("list-files", (_e, folder) => {
  const root = path.resolve(folder);
  if (root !== allowedRoot) throw new Error("That folder was not chosen in this session.");
  const describe = (p) => ({ name: path.basename(p), path: p, size: fs.statSync(p).size });
  const dats = ["patch000.dat", "critter.dat", "master.dat"].map((n) => findChild(root, n)).filter(Boolean).map(describe);
  let music = [];
  for (const base of [root, findChild(root, "data")].filter(Boolean)) {
    const sound = findChild(base, "sound");
    const dir = sound && findChild(sound, "music");
    if (!dir) continue;
    music = fs
      .readdirSync(dir)
      .filter((n) => n.toLowerCase().endsWith(".acm"))
      .map((n) => describe(path.join(dir, n)));
    if (music.length) break;
  }
  return { dats, music };
});

ipcMain.handle("read", async (_e, file, offset, length) => {
  const p = path.resolve(file);
  if (!allowedRoot || !p.startsWith(allowedRoot + path.sep)) throw new Error("Read outside the Fallout 2 folder was blocked.");
  const fh = await fsp.open(p, "r");
  try {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await fh.read(buf, 0, length, offset);
    return new Uint8Array(buf.buffer, buf.byteOffset, bytesRead);
  } finally {
    await fh.close();
  }
});

// Progress between runs. Written to a temp file first, then renamed, so a crash can't corrupt it.
const saveFile = () => path.join(app.getPath("userData"), "save.json");
ipcMain.handle("save-read", () => {
  try {
    return fs.readFileSync(saveFile(), "utf8");
  } catch {
    return null;
  }
});
ipcMain.handle("save-write", (_e, text) => {
  if (typeof text !== "string" || text.length > 1_000_000) throw new Error("Save data rejected.");
  fs.mkdirSync(path.dirname(saveFile()), { recursive: true });
  const tmp = saveFile() + ".tmp";
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, saveFile());
});

ipcMain.on("quit", () => app.quit());

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    fullscreen: true,
    backgroundColor: "#120e0b",
    autoHideMenuBar: true,
    title: "Rad Survivors",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key === "F11") {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    }
  });
  win.loadFile(path.join(__dirname, "app", "index.html"));
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
