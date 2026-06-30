#!/usr/bin/env node
// Cross-platform, zero-dependency zip packager for Tencent SCF deployment.
// Creates dist.zip:
//   - excludes .git / .claude / dist.zip / *.log
//   - marks scf_bootstrap as executable (Unix 0o755) so SCF can run it
// No external tools (zip/7z/powershell) or npm deps required.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outFile = path.join(root, 'dist.zip');
if (fs.existsSync(outFile)) fs.rmSync(outFile);

function shouldExclude(rel) {
  const parts = rel.split('/');
  if (parts.some((p) => p === '.git' || p === '.claude')) return true;
  if (rel === 'dist.zip') return true;
  const ext = path.extname(parts[parts.length - 1]).toLowerCase();
  if (ext === '.log') return true;
  return false;
}

// ---- CRC32 ----
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(ms) {
  const d = new Date(ms);
  const t = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const dt = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0xf) << 5) | (d.getDate() & 0x1f);
  return [t & 0xffff, dt & 0xffff];
}

const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v & 0xffff, 0); return b; };
const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0, 0); return b; };

// ---- collect files ----
const files = [];
function walk(dir, rel) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const r = rel ? rel + '/' + name : name;
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      if (shouldExclude(r + '/')) continue;
      walk(full, r);
    } else if (st.isFile()) {
      if (shouldExclude(r)) continue;
      files.push({ rel: r, full, mtime: st.mtimeMs });
    }
  }
}
walk(root, '');

const chunks = [];
const central = [];
let offset = 0;
let bootstrapMode = 0;

for (const f of files) {
  const data = fs.readFileSync(f.full);
  const crc = crc32(data);
  const nameBuf = Buffer.from(f.rel, 'utf8');
  const [t, dt] = dosDateTime(f.mtime);
  const isBootstrap = f.rel === 'scf_bootstrap';
  const mode = isBootstrap ? 0o100755 : 0o100644; // S_IFREG | perms
  if (isBootstrap) bootstrapMode = mode;

  const local = Buffer.concat([
    u32(0x04034b50), u16(20), u16(0x800), u16(0), u16(t), u16(dt),
    u32(crc), u32(data.length), u32(data.length),
    u16(nameBuf.length), u16(0), nameBuf,
  ]);
  chunks.push(local, data);

  central.push(Buffer.concat([
    u32(0x02014b50), u16((3 << 8) | 20), u16(20), u16(0x800), u16(0),
    u16(t), u16(dt), u32(crc), u32(data.length), u32(data.length),
    u16(nameBuf.length), u16(0), u16(0), u16(0), u16(0),
    u32(mode << 16), u32(offset), nameBuf,
  ]));
  offset += local.length + data.length;
}

const cd = Buffer.concat(central);
const eocd = Buffer.concat([
  u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
  u32(cd.length), u32(offset), u16(0),
]);

fs.writeFileSync(outFile, Buffer.concat([...chunks, cd, eocd]));
console.log('Created dist.zip with', files.length, 'entries' + (bootstrapMode ? ' (scf_bootstrap mode 0o755)' : '') + '.');
