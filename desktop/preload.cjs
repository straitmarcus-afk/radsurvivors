// Exposes a small API to the game page as window.radDesktop: read-only access to the Fallout 2 folder, plus the save file.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("radDesktop", {
  getFolder: () => ipcRenderer.invoke("get-folder"),
  pickFolder: () => ipcRenderer.invoke("pick-folder"),
  listFiles: (folder) => ipcRenderer.invoke("list-files", folder),
  read: (file, offset, length) => ipcRenderer.invoke("read", file, offset, length),
  loadSave: () => ipcRenderer.invoke("save-read"),
  writeSave: (text) => ipcRenderer.invoke("save-write", text),
  quit: () => ipcRenderer.send("quit"),
});
