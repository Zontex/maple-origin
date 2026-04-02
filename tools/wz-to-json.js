#!/usr/bin/env node
/**
 * WZ-to-JSON converter for MapleStory v83 .wz files.
 *
 * Reads .wz binary files using MapleStory-node-resources parser
 * and outputs the $imgdir/$canvas/$$ JSON format used by the client.
 *
 * Usage:
 *   node tools/wz-to-json.js <input.wz> <output_dir>
 *
 * Examples:
 *   node tools/wz-to-json.js 83/String.wz TypeScript-Client/public/wz_client/String.wz/
 *   node tools/wz-to-json.js 83/UI.wz TypeScript-Client/public/wz_client/UI.wz/
 */

const path = require('path');
const fs = require('fs');
const { wz_file, wz_image } = require('./wz-parser/parser');

const INPUT_WZ = process.argv[2];
const OUTPUT_DIR = process.argv[3];

if (!INPUT_WZ || !OUTPUT_DIR) {
  console.error('Usage: node tools/wz-to-json.js <input.wz> <output_dir>');
  process.exit(1);
}

// Recursively extract all nested ImageNodes (full depth, error-tolerant)
async function deepExtract(node) {
  if (!node) return;
  try {
    if (node.type === 'ImageNode' && node.extractImg) {
      await node.extractImg();
    }
  } catch (e) { return; } // skip nodes that fail to parse

  const val = node.value;
  if (!val) return;

  const children = val.children || [];
  for (const child of children) {
    if (child.type === 'image' && child.value) {
      await deepExtract(child.value);
    }
  }
}

// Convert a fully-extracted node tree to the $imgdir/$canvas/$$ JSON format
async function convertNode(name, node) {
  if (!node || !node.value) return null;
  const val = node.value;

  if (val.class === 'Property') {
    const result = { $imgdir: name };
    const children = await convertChildren(val.children);
    if (children.length > 0) result.$$ = children;
    return result;
  }

  if (val.class === 'Canvas') {
    const result = {
      $canvas: name,
      width: String(val.value.width),
      height: String(val.value.height),
    };
    // Extract PNG as base64
    try {
      const { PNG } = require('./wz-parser/node_modules/pngjs');
      const pngObj = await val.value.extractPNG();
      if (pngObj && pngObj.data) {
        const pngBuf = PNG.sync.write(pngObj);
        result.basedata = pngBuf.toString('base64');
      }
    } catch (e) {
      // Some images use unsupported pixel formats — skip gracefully
      if (e.message && !e.message.includes('unsure')) {
        process.stderr.write(`    [img-err] ${name}: ${e.message}\n`);
      }
    }
    const children = await convertChildren(val.children);
    if (children.length > 0) result.$$ = children;
    return result;
  }

  if (val.class === 'Shape2D#Vector2D') {
    return { $vector: name, x: String(val.value.x), y: String(val.value.y) };
  }

  if (val.class === 'Shape2D#Convex2D') {
    const result = { $imgdir: name };
    if (val.value && Array.isArray(val.value)) {
      result.$$ = val.value.map((v, i) => ({
        $vector: String(i), x: String(v.x), y: String(v.y),
      }));
    }
    return result;
  }

  if (val.class === 'Sound_DX8') {
    const result = { $sound: name };
    try {
      const soundData = await val.value.extractSound();
      if (soundData && soundData.length > 0) {
        const buf = Buffer.isBuffer(soundData) ? soundData : Buffer.from(soundData);
        result.basedata = buf.toString('base64');
      }
    } catch (e) { /* skip failed sounds */ }
    return result;
  }

  if (val.class === 'UOL') {
    return { $uol: name, value: val.value.link.join('/') };
  }

  return null;
}

async function convertChildren(children) {
  if (!children) return [];
  const results = [];
  for (const child of children) {
    const converted = await convertChild(child);
    if (converted) results.push(converted);
  }
  return results;
}

async function convertChild(child) {
  if (!child) return null;

  if (child.type === 'integer') {
    return { $int: child.name, value: String(child.value) };
  }
  if (child.type === 'float') {
    return { $float: child.name, value: String(child.value) };
  }
  if (child.type === 'string') {
    return { $string: child.name, value: String(child.value || '') };
  }
  if (child.type === 'null') {
    return { $imgdir: child.name };
  }
  if (child.type === 'image' && child.value) {
    return convertNode(child.name, child.value);
  }

  return null;
}

// Compact JSON serializer matching the nodin/existing format
function serializeJson(obj, indentLevel = 0, indent = '  ') {
  let ret = '{';
  const keys = Object.keys(obj).filter(k => k !== '$$');
  for (const key of keys) {
    const val = String(obj[key])
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
    ret += `"${key}":"${val}",`;
  }

  if (!obj.$$) {
    if (ret.endsWith(',')) return ret.slice(0, -1) + '}';
    return ret + '}';
  }

  const children = obj.$$.map(c => serializeJson(c, indentLevel + 1, indent));
  ret += '"$$":[\n';
  for (let i = 0; i < children.length; i++) {
    ret += indent.repeat(indentLevel + 1) + children[i];
    if (i < children.length - 1) ret += ',';
    ret += '\n';
  }
  ret += indent.repeat(indentLevel) + ']}';
  return ret;
}

async function processImg(imgInfo, outputPath) {
  try {
    const img = new wz_image(imgInfo);
    img.parse();
    if (!img.value) return;

    // Recursively extract all nested nodes
    await deepExtract(img.value);

    // Convert to JSON structure
    const json = await convertNode(imgInfo.name, img.value);
    if (!json) return;

    // Write
    const dir = path.dirname(outputPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(outputPath, serializeJson(json));

    try { img.release(); } catch (e) { /* ignore */ }
  } catch (e) {
    console.error(`  Error: ${imgInfo.name}: ${e.message}`);
  }
}

async function processDir(dirInfo, outputDir, depth = 0) {
  if (!dirInfo.dir) return;

  for (let i = 0; i < dirInfo.dir.length; i++) {
    const entry = dirInfo.dir[i];
    if (entry.dirs) {
      const subDir = path.join(outputDir, entry.name);
      await processDir(entry, subDir, depth + 1);
    } else {
      const outFile = path.join(outputDir, entry.name + '.json');
      const progress = depth === 0 ? ` [${i + 1}/${dirInfo.dir.length}]` : '';
      process.stdout.write(`  ${entry.name}${progress}\r`);
      await processImg(entry, outFile);
    }
  }
}

async function main() {
  const wzName = path.basename(INPUT_WZ);
  console.log(`Parsing ${wzName}...`);

  const wz = new wz_file(path.resolve(INPUT_WZ));
  await wz.parse();

  if (!wz.value || !wz.value.dir) {
    console.error('Failed to parse WZ file');
    process.exit(1);
  }

  console.log(`Found ${wz.value.dir.length} entries in ${wzName}`);
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  await processDir(wz.value, OUTPUT_DIR);

  wz.release();
  console.log(`\nDone! Output in ${OUTPUT_DIR}`);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
