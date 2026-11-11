// Permanent deletion with guard rails.
// Files are unlinked directly with fs.rm — they never pass through the Trash / Recycle Bin.
'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';
// macOS (APFS default) and Windows file systems are case-insensitive.
const norm = (p) => {
  let r = path.resolve(p);
  if (r.length > 1 && (r.endsWith(path.sep))) r = r.slice(0, -1);
  return isWin || isMac ? r.toLowerCase() : r;
};

function protectedPaths() {
  const home = os.homedir();
  const homeKids = ['Desktop', 'Documents', 'Downloads', 'Library', 'Pictures', 'Music', 'Movies',
    'Videos', 'Applications', 'Public', 'AppData', 'OneDrive', 'iCloud Drive'];
  const list = [home, ...homeKids.map((k) => path.join(home, k))];

  if (isWin) {
    const sys = process.env.SystemDrive || 'C:';
    list.push(
      process.env.SystemRoot || path.join(sys, '\\Windows'),
      process.env.ProgramFiles || path.join(sys, '\\Program Files'),
      process.env['ProgramFiles(x86)'] || path.join(sys, '\\Program Files (x86)'),
      process.env.ProgramData || path.join(sys, '\\ProgramData'),
      path.join(sys, '\\Users'),
    );
  } else {
    list.push('/', '/System', '/Library', '/Applications', '/Users', '/Volumes', '/usr', '/bin',
      '/sbin', '/etc', '/var', '/private', '/opt', '/cores', '/dev', '/home', '/root', '/boot', '/proc');
  }
  return list.map(norm);
}

// Whole subtrees that are never touched (deleting inside them can break the OS).
function forbiddenTrees() {
  if (isWin) {
    const sys = process.env.SystemDrive || 'C:';
    return [process.env.SystemRoot || path.join(sys, '\\Windows')].map(norm);
  }
  const trees = ['/System', '/usr', '/bin', '/sbin', '/etc', '/dev', '/proc', '/boot'];
  if (isMac) trees.push('/private/etc', '/private/var/db', '/Library/Apple', '/cores');
  return trees.map(norm);
}

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Returns a reason string if the path must not be devoured, else null.
 * appPaths: locations of the running app itself.
 */
function refusalReason(target, appPaths = []) {
  if (!target || !path.isAbsolute(target)) return 'Not an absolute file path';
  const t = norm(target);

  // Drive roots like C:\ or D:\
  if (isWin && /^[a-z]:\\?$/i.test(t)) return 'Refusing to swallow an entire drive';
  if (t === norm(path.parse(t).root)) return 'Refusing to swallow a whole disk';

  for (const p of protectedPaths()) {
    if (t === p) return 'Protected system or home folder';
    if (isInside(p, t)) return 'Contains a protected system or home folder';
  }
  for (const p of forbiddenTrees()) {
    if (isInside(t, p)) return 'Inside a protected operating-system folder';
  }
  for (const a of appPaths) {
    const n = norm(a);
    if (isInside(t, n) || isInside(n, t)) return 'That is the Gluttony Hole itself';
  }
  // macOS volume mount points (/Volumes/X)
  if (isMac && path.dirname(t) === norm('/Volumes')) return 'Refusing to swallow an entire volume';
  return null;
}

async function sizeOf(p, budget = { n: 200000 }) {
  let st;
  try { st = await fsp.lstat(p); } catch { return 0; }
  if (!st.isDirectory()) return st.size;
  let total = 0;
  let entries = [];
  try { entries = await fsp.readdir(p); } catch { return 0; }
  for (const e of entries) {
    if (--budget.n <= 0) break;
    total += await sizeOf(path.join(p, e), budget);
  }
  return total;
}

async function makeWritable(p) {
  try {
    const st = await fsp.lstat(p);
    if (st.isSymbolicLink()) return;
    await fsp.chmod(p, st.isDirectory() ? 0o777 : 0o666);
    if (st.isDirectory()) {
      for (const e of await fsp.readdir(p)) await makeWritable(path.join(p, e));
    }
  } catch { /* best effort */ }
}

async function devourOne(target, appPaths) {
  const reason = refusalReason(target, appPaths);
  if (reason) return { path: target, ok: false, error: reason };

  let st;
  try { st = await fsp.lstat(target); } catch { return { path: target, ok: false, error: 'Already gone' }; }

  const bytes = await sizeOf(target);
  const opts = { recursive: true, force: false, maxRetries: 3, retryDelay: 120 };
  try {
    await fsp.rm(target, opts);
  } catch (err) {
    if (err.code === 'EPERM' || err.code === 'EACCES') {
      // Read-only attributes (common on Windows) — clear them and try once more.
      await makeWritable(target);
      try { await fsp.rm(target, opts); } catch (err2) { return { path: target, ok: false, error: explain(err2) }; }
    } else {
      return { path: target, ok: false, error: explain(err) };
    }
  }
  return { path: target, ok: true, bytes, isDir: st.isDirectory() };
}

function explain(err) {
  switch (err.code) {
    case 'EPERM':
    case 'EACCES':
      return isMac
        ? 'Permission denied (the file is locked, or Gluttony Hole needs Full Disk Access)'
        : 'Permission denied (file locked or owned by the system)';
    case 'EBUSY': return 'File is in use by another program';
    case 'ENOTEMPTY': return 'Folder could not be fully emptied';
    default: return err.message || String(err);
  }
}

async function devour(paths, appPaths) {
  const unique = [...new Set(paths.filter(Boolean))];
  const results = [];
  for (const p of unique) results.push(await devourOne(p, appPaths));
  return results;
}

module.exports = { devour, refusalReason };
