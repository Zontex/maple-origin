#!/usr/bin/env node
/**
 * Converts shop SQL data from the Cosmic backend into a JSON file
 * that the TypeScript client can load at runtime.
 *
 * Usage: node tools/convert-shops.js
 * Output: TypeScript-Client/public/data/shops.json
 */

const fs = require('fs');
const path = require('path');

const BACKEND_DB = path.join(__dirname, '..', 'backend', 'src', 'main', 'resources', 'db', 'data');
const OUTPUT = path.join(__dirname, '..', 'TypeScript-Client', 'public', 'data', 'shops.json');

// Parse shops SQL — (shopid, npcid)
function parseShops(sql) {
  const map = new Map();
  const re = /\((\d+),\s*(\d+)\)/g;
  let m;
  while ((m = re.exec(sql)) !== null) {
    map.set(parseInt(m[1]), parseInt(m[2]));
  }
  return map;
}

// Parse shopitems SQL — (shopid, itemid, price, pitch, position)
function parseShopItems(sql) {
  const map = new Map();
  const re = /\((\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+)\)/g;
  let m;
  while ((m = re.exec(sql)) !== null) {
    const shopId = parseInt(m[1]);
    const item = {
      itemId: parseInt(m[2]),
      price: parseInt(m[3]),
      position: parseInt(m[5]),
    };
    if (!map.has(shopId)) map.set(shopId, []);
    map.get(shopId).push(item);
  }
  // Sort each shop's items by position
  for (const [, items] of map) {
    items.sort((a, b) => a.position - b.position);
  }
  return map;
}

// Main
const shopsSql = fs.readFileSync(path.join(BACKEND_DB, '101-shops-data.sql'), 'utf8');
const itemsSql = fs.readFileSync(path.join(BACKEND_DB, '102-shopitems-data.sql'), 'utf8');

const shopsMap = parseShops(shopsSql);
const itemsMap = parseShopItems(itemsSql);

const result = {};
for (const [shopId, npcId] of shopsMap) {
  const items = itemsMap.get(shopId) || [];
  result[shopId] = { npcId, items };
}

// Also include shops that appear in shopitems but not in shops table (use shopId as npcId)
for (const [shopId, items] of itemsMap) {
  if (!result[shopId]) {
    result[shopId] = { npcId: shopId, items };
  }
}

fs.writeFileSync(OUTPUT, JSON.stringify(result));
console.log(`Written ${Object.keys(result).length} shops to ${OUTPUT}`);
