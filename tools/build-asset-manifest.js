#!/usr/bin/env node
// Builds public/asset-manifest.json for the first-run asset downloader.
// Lists every game-data file (WZ JSON, scripts, data) with its byte size so
// the client can pre-download the whole set with real progress and serve it
// cache-first afterwards (browser Cache Storage now, Capacitor later).
//
// Run after any asset change:  node tools/build-asset-manifest.js

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const publicDir = path.join(__dirname, '..', 'TypeScript-Client', 'public');
const ROOTS = ['wz_client', 'scripts', 'data'];

const files = [];
let totalBytes = 0;

function walk(dir, rel) {
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const abs = path.join(dir, e.name);
    const relPath = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      walk(abs, relPath);
    } else {
      const size = fs.statSync(abs).size;
      files.push({ p: relPath, s: size });
      totalBytes += size;
    }
  }
}

for (const root of ROOTS) {
  const abs = path.join(publicDir, root);
  if (fs.existsSync(abs)) walk(abs, root);
}

// Version = hash of the file list + sizes: changes whenever assets change,
// stable across rebuilds when they don't
const hash = crypto.createHash('sha1');
for (const f of files) hash.update(`${f.p}:${f.s};`);
const version = hash.digest('hex').slice(0, 12);

const manifest = { version, totalBytes, fileCount: files.length, files };
const outPath = path.join(publicDir, 'asset-manifest.json');
fs.writeFileSync(outPath, JSON.stringify(manifest));

console.log(
  `asset-manifest.json: ${files.length} files, ` +
  `${(totalBytes / 1024 / 1024 / 1024).toFixed(2)} GB, version ${version}`
);
