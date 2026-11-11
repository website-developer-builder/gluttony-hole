# Gluttony Hole

A small, live, ray-traced black hole that sits in a corner of your desktop (macOS + Windows).
Drag any file or folder onto it and it is **permanently deleted**. It does not go to the Trash or Recycle Bin, and you cannot undo it.

## Install

| Platform | File (in `dist/`) |
|---|---|
| Mac (Apple Silicon) | `Gluttony Hole-1.0.0-arm64.dmg` |
| Mac (Intel) | `Gluttony Hole-1.0.0.dmg` |
| Windows installer | `Gluttony Hole Setup 1.0.0.exe` |
| Windows portable (no install) | `Gluttony Hole 1.0.0.exe` |

The builds are not code-signed, so the OS warns you the first time you open one:
- **Mac:** right-click the app, choose **Open**, then **Open** again. Or go to System Settings → Privacy & Security → *Open Anyway*.
- **Windows:** in SmartScreen, click **More info** and then **Run anyway**.

## Using it

- **Drop files or folders** on the hole. They spiral in and are deleted at once.
- **Drag the hole** to move it. Its position is remembered.
- **Right-click the hole**, or click the tray/menu-bar icon, to set:
  - Corner, Size (Small/Medium/Large)
  - Look: Tilted (cinematic), Warm glow, or Edge-on
  - Render quality: High, or Battery saver (30 fps, fewer ray steps)
  - Ask before devouring: off by default. Turn it on to get a confirmation dialog.
  - Sound, Launch at login, and a running total of everything devoured

## Safety rails (always on)
The hole refuses, and spits back out:
- disk/drive roots, `/Volumes/*` mounts
- your home folder and its main folders as a whole (Desktop, Documents, Downloads, Library, …). Files *inside* them are fine.
- OS folders: `/System`, `/usr`, `/bin`, `/etc`, `C:\Windows`, Program Files, etc.
- the Gluttony Hole app itself

On macOS, files in protected locations may need **Full Disk Access** (System Settings → Privacy & Security).

Deletion unlinks the file. It is not a secure wipe, so forensic recovery tools may still be able to recover data from free disk space.

## Development

```bash
npm install
npm start            # run it
npm run icons        # regenerate tray icons + app icon from the shader
npm run dist:mac     # build DMG/zip
npm run dist:win     # build Windows installer + portable exe
```

- `src/main.js`: window, tray menu, settings, IPC
- `src/devour.js`: permanent deletion and protected-path rules
- `src/renderer/shader.js`: Schwarzschild geodesic ray-tracer (lensing, Doppler beaming, photon ring)
- `src/renderer/app.js`: WebGL loop, drag & drop, swallow animation, sound
