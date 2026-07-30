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

// Cosmic DB seed data preserved from the (now-deleted) Cosmic backend reference copy
const BACKEND_DB = path.join(__dirname, 'cosmic-db-data');
const OUTPUT = path.join(__dirname, '..', 'TypeScript-Client', 'public', 'data', 'shops.json');

// Cosmic private-server extras that never existed in GMS v83 — excluded for 1:1 GMS accuracy.
// Note: shop 11000 is Sid's legitimate beginner weapon shop; only 1337 (GM test shop,
// also mapped to NPC 11000) is unofficial.
const UNOFFICIAL_SHOPS = new Set([
  1337, // GM test shop: Monster Sacks, Wizet/GM gear, White Scrolls, mounts at 1 meso
  // Polar bear Poch (9001002) GM showcase shops: 373 items (hats, capes, rings,
  // scrolls, mounts...) all at <=1 meso — Cosmic event-gifting tool, not a GMS shop
  9999992, 9999993, 9999994, 9999995, 9999996, 9999997, 9999998, 9999999,
]);

// GM/unobtainable items that must never appear in any shop.
function isUnofficialItem(itemId) {
  if (itemId >= 2100000 && itemId <= 2100999) return true; // Monster Sacks
  return [
    1002140, // Wizet Invincible Hat
    1002959, // Junior GM Cap
    1042003, // Wizet Plain Suit
    1062007, // Wizet Plain Suit Pants
    1322013, // Wizet Secret Agent Suitcase
  ].includes(itemId);
}

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
    // pitch > 0 means the item is sold for event-token currency, not mesos
    // (e.g. Inkwell in Henesys). Without token support, including them would
    // sell event gear for ~0 mesos — skip until pitch currency is implemented.
    if (parseInt(m[4]) > 0) continue;
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
  if (UNOFFICIAL_SHOPS.has(shopId) || UNOFFICIAL_SHOPS.has(npcId)) continue;
  const items = (itemsMap.get(shopId) || []).filter((i) => !isUnofficialItem(i.itemId));
  if (items.length === 0) continue;
  result[shopId] = { npcId, items };
}

// Also include shops that appear in shopitems but not in shops table (use shopId as npcId)
for (const [shopId, items] of itemsMap) {
  if (result[shopId] || UNOFFICIAL_SHOPS.has(shopId)) continue;
  const filtered = items.filter((i) => !isUnofficialItem(i.itemId));
  if (filtered.length === 0) continue;
  result[shopId] = { npcId: shopId, items: filtered };
}

fs.writeFileSync(OUTPUT, JSON.stringify(result));
console.log(`Written ${Object.keys(result).length} shops to ${OUTPUT}`);
