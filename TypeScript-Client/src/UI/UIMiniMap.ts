import WZManager from '../wz-utils/WZManager';
import GameCanvas from '../GameCanvas';
import { CameraInterface } from '../Camera';
import MapleMap from '../MapleMap';
import MyCharacter from '../MyCharacter';
import UIWorldMap from './UIWorldMap';

interface MiniMapFrame {
  nw: HTMLImageElement;
  n: HTMLImageElement;
  ne: HTMLImageElement;
  w: HTMLImageElement;
  e: HTMLImageElement;
  sw: HTMLImageElement;
  s: HTMLImageElement;
  se: HTMLImageElement;
  c: HTMLImageElement;
}

interface MiniMapIcons {
  user: HTMLImageElement;
  another: HTMLImageElement;
  npc: HTMLImageElement;
  portal: HTMLImageElement;
  party: HTMLImageElement;
}

interface MiniMapData {
  canvas: HTMLImageElement;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  mag: number;
}

// Every mark in Map.wz/MapHelper.img/mark is 38x38 (Halloween alone is 39
// wide). Laying the header out on the constant rather than the image's own
// width keeps the names from shifting when a mark decodes a frame or two late.
const MAP_MARK_SIZE = 38;

const UIMiniMap = {
  initialized: false,
  frame: null as MiniMapFrame | null,
  icons: null as MiniMapIcons | null,
  marks: {} as { [key: string]: HTMLImageElement },
  titleImg: null as HTMLImageElement | null,
  worldBtnNormal: null as HTMLImageElement | null,

  // Current map minimap data
  mapData: null as MiniMapData | null,
  mapMark: null as HTMLImageElement | null,
  mapMarkName: '',

  // Hidden only for maps with no minimap data (info/hideMinimap)
  isHidden: false,
  // v83 minimap states: 'max' = full map, 'min' = collapsed title strip.
  // The M key (or the -/+ header buttons) toggles between them.
  viewMode: 'max' as 'max' | 'min',
  minStrip: null as { w: HTMLImageElement; c: HTMLImageElement; e: HTMLImageElement } | null,
  btMin: null as HTMLImageElement | null,
  btMax: null as HTMLImageElement | null,
  // Hitboxes for the collapsed strip's buttons, rebuilt each frame it renders
  _minLayout: null as {
    btMaxX: number; btMaxY: number; btMaxW: number; btMaxH: number;
    mapBtnX: number; mapBtnY: number; mapBtnW: number; mapBtnH: number;
  } | null,

  // Cached offscreen canvas for the static frame (rebuilt on map change)
  _cachedFrame: null as HTMLCanvasElement | null,
  // Set when _buildCache had to skip a sprite that hadn't decoded yet
  _cacheIncomplete: false,
  _cachedW: 0,
  _cachedH: 0,
  // Layout values stored after cache build for icon positioning
  _layout: null as {
    bx: number; by: number;
    mapDrawX: number; mapDrawY: number;
    mapImgW: number; mapImgH: number;
    totalW: number; totalH: number;
    nwW: number; nwH: number; neW: number;
    innerW: number; innerH: number;
    worldBtnX: number; worldBtnY: number;
    worldBtnW: number; worldBtnH: number;
    minBtnX: number; minBtnY: number;
    minBtnW: number; minBtnH: number;
  } | null,

  // Methods are attached below (UIMiniMap.initialize = ...); declared here
  // so the inferred type carries them for the callers in MapState/MapleMap
  initialize: undefined as unknown as () => Promise<void>,
  loadMapData: undefined as unknown as () => void,
  _resolveMapMark: undefined as unknown as () => void,
  _buildCache: undefined as unknown as () => void,
  update: undefined as unknown as (msPerTick: number) => void,
  render: undefined as unknown as (canvas: GameCanvas, camera: CameraInterface) => void,
  handleClick: undefined as unknown as (cx: number, cy: number) => boolean,
};

UIMiniMap.initialize = async function () {
  if (this.initialized) return;

  try {
    const uiWindow: any = await WZManager.get('UI.wz/UIWindow.img');
    const miniMapNode = uiWindow.MiniMap;

    const maxMap = miniMapNode.MaxMap;
    this.frame = {
      nw: maxMap.nw.nGetImage(),
      n: maxMap.n.nGetImage(),
      ne: maxMap.ne.nGetImage(),
      w: maxMap.w.nGetImage(),
      e: maxMap.e.nGetImage(),
      sw: maxMap.sw.nGetImage(),
      s: maxMap.s.nGetImage(),
      se: maxMap.se.nGetImage(),
      c: maxMap.c.nGetImage(),
    };

    this.titleImg = miniMapNode.title.nGetImage();
    this.worldBtnNormal = miniMapNode.BtMap.normal.nGet('0').nGetImage();

    const minNode = miniMapNode.Min;
    this.minStrip = {
      w: minNode.w.nGetImage(),
      c: minNode.c.nGetImage(),
      e: minNode.e.nGetImage(),
    };

    // v83 minimap header buttons: blue -/+ squares from Basic.img
    const basic: any = await WZManager.get('UI.wz/Basic.img');
    this.btMin = basic.BtMin.normal.nGet('0').nGetImage();
    this.btMax = basic.BtMax.normal.nGet('0').nGetImage();

    const mapHelper: any = await WZManager.get('Map.wz/MapHelper.img');
    const mmIcons = mapHelper.minimap;
    this.icons = {
      user: mmIcons.user.nGetImage(),
      another: mmIcons.another.nGetImage(),
      npc: mmIcons.npc.nGetImage(),
      portal: mmIcons.portal.nGetImage(),
      party: mmIcons.party.nGetImage(),
    };

    const markNode = mapHelper.mark;
    for (const child of markNode.nChildren) {
      this.marks[child.nName] = child.nGetImage();
    }

    this.initialized = true;

    // MapState loads the first map *before* it initializes the HUD, so that
    // map's loadMapData() looked the mark up in a table this function had not
    // filled yet and left the header iconless until the next map change. The
    // marks exist now — resolve the one the current map wanted.
    this._resolveMapMark();
  } catch (e) {
    console.error('[UIMiniMap] Failed to initialize:', e);
  }
};

/**
 * Point mapMark at the current map's icon. Safe to call again at any time:
 * it only ever upgrades a missing mark into a present one, and invalidates
 * the cached header so the new icon actually gets drawn.
 */
UIMiniMap._resolveMapMark = function () {
  if (this.mapMark || !MapleMap.wzNode) return;

  const markName = MapleMap.wzNode.info?.mapMark?.nValue;
  if (!markName || !this.marks[markName]) return;

  this.mapMark = this.marks[markName];
  this.mapMarkName = markName;
  this._cachedFrame = null;
  this._layout = null;
};

UIMiniMap.loadMapData = function () {
  this.mapData = null;
  this.mapMark = null;
  this._cachedFrame = null;
  this._layout = null;

  if (!MapleMap.wzNode) return;

  const hideMinimap = MapleMap.wzNode.info?.hideMinimap?.nValue;
  if (hideMinimap) return;

  const mmNode = MapleMap.wzNode.miniMap;
  if (!mmNode || !mmNode.canvas) return;

  try {
    this.mapData = {
      canvas: mmNode.canvas.nGetImage(),
      width: mmNode.width.nValue,
      height: mmNode.height.nValue,
      centerX: mmNode.centerX.nValue,
      centerY: mmNode.centerY.nValue,
      mag: mmNode.mag?.nValue || 4,
    };

    this._resolveMapMark();

    this.isHidden = false;
  } catch (e) {
    console.error('[UIMiniMap] Failed to load map data:', e);
  }
};

/**
 * Build the static frame + header + map image into an offscreen canvas.
 * Called once per map, then blitted every frame as a single drawImage.
 */
UIMiniMap._buildCache = function () {
  if (!this.frame || !this.mapData) return;

  const md = this.mapData;
  const fr = this.frame;

  const rawImgW = md.canvas.width || 0;
  const rawImgH = md.canvas.height || 0;
  if (rawImgW === 0 || rawImgH === 0) return;

  // Cap minimap image size to keep it compact like the original v83 client
  const MAX_MAP_W = 200;
  const MAX_MAP_H = 200;
  let mapScale = 1;
  if (rawImgW > MAX_MAP_W || rawImgH > MAX_MAP_H) {
    mapScale = Math.min(MAX_MAP_W / rawImgW, MAX_MAP_H / rawImgH);
  }
  const mapImgW = Math.round(rawImgW * mapScale);
  const mapImgH = Math.round(rawImgH * mapScale);

  const nwW = fr.nw.width || 6;
  const nwH = fr.nw.height || 72;
  const neW = fr.ne.width || 6;
  const swH = fr.sw.height || 15;

  const padX = 7;
  const padY = 5;

  // Measure header text width so the frame is wide enough to show map/street names
  const hdrMarkW = this.mapMark ? MAP_MARK_SIZE : 0;
  const hdrNameX = nwW + 7 + hdrMarkW + 10;
  let headerTextW = 0;
  if (MapleMap.names) {
    const measureCanvas = document.createElement('canvas');
    const measureCtx = measureCanvas.getContext('2d')!;
    const streetName = MapleMap.names.streetName || '';
    const mapName = MapleMap.names.mapName || '';
    if (streetName) {
      measureCtx.font = 'bold 13px Arial';
      headerTextW = Math.max(headerTextW, measureCtx.measureText(streetName).width);
    }
    if (mapName) {
      measureCtx.font = '13px Arial';
      headerTextW = Math.max(headerTextW, measureCtx.measureText(mapName).width);
    }
  }
  // Inner width must fit the map image AND the header (mark icon + text + padding)
  const headerNeedsW = hdrNameX - nwW + headerTextW + 10;
  const innerW = Math.max(mapImgW + padX * 2, headerNeedsW, 120);
  const innerH = mapImgH + padY * 2;
  const totalW = nwW + innerW + neW;
  const totalH = nwH + innerH + swH;

  // Create offscreen canvas
  const offscreen = document.createElement('canvas');
  offscreen.width = totalW;
  offscreen.height = totalH;
  const ctx = offscreen.getContext('2d')!;

  // Helper to draw an image at (x, y). This cache is built once per map and
  // blitted every frame afterwards, so anything skipped here because it
  // hadn't decoded yet would be missing from the minimap for the whole map —
  // record the miss and rebuild next frame instead.
  let incomplete = false;
  const draw = (img: HTMLImageElement, x: number, y: number) => {
    if (img && img.width > 0) {
      ctx.drawImage(img, x, y);
    } else if (img) {
      incomplete = true;
    }
  };

  // --- 9-patch frame ---
  // Corners
  draw(fr.nw, 0, 0);
  draw(fr.ne, totalW - neW, 0);
  draw(fr.sw, 0, totalH - swH);
  draw(fr.se, totalW - neW, totalH - swH);

  // Top edge
  ctx.save();
  ctx.beginPath();
  ctx.rect(nwW, 0, innerW, nwH);
  ctx.clip();
  for (let tx = nwW; tx < nwW + innerW; tx += (fr.n.width || 1)) {
    draw(fr.n, tx, 0);
  }
  ctx.restore();

  // Bottom edge
  ctx.save();
  ctx.beginPath();
  ctx.rect(nwW, totalH - swH, innerW, swH);
  ctx.clip();
  for (let tx = nwW; tx < nwW + innerW; tx += (fr.s.width || 1)) {
    draw(fr.s, tx, totalH - swH);
  }
  ctx.restore();

  // Left edge
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, nwH, nwW, innerH);
  ctx.clip();
  for (let ty = nwH; ty < nwH + innerH; ty += (fr.w.height || 1)) {
    draw(fr.w, 0, ty);
  }
  ctx.restore();

  // Right edge
  ctx.save();
  ctx.beginPath();
  ctx.rect(totalW - neW, nwH, neW, innerH);
  ctx.clip();
  for (let ty = nwH; ty < nwH + innerH; ty += (fr.e.height || 1)) {
    draw(fr.e, totalW - neW, ty);
  }
  ctx.restore();

  // Center fill — use fillStyle pattern instead of per-pixel drawImage
  ctx.save();
  ctx.beginPath();
  ctx.rect(nwW, nwH, innerW, innerH);
  ctx.clip();
  if (fr.c.width > 0 && fr.c.height > 0) {
    const pattern = ctx.createPattern(fr.c, 'repeat');
    if (pattern) {
      ctx.translate(nwW, nwH);
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, innerW, innerH);
    }
  }
  ctx.restore();

  // --- Header content ---
  // "MINI MAP" title
  if (this.titleImg && this.titleImg.width > 0) {
    draw(this.titleImg, nwW + 5, 8);
  }

  // WORLD button + minimize (-) button to its left, like the v83 header
  const worldBtnW = this.worldBtnNormal?.width || 36;
  const worldBtnH = this.worldBtnNormal?.height || 12;
  const worldBtnX = totalW - neW - worldBtnW - 4;
  const worldBtnY = 6;
  if (this.worldBtnNormal && this.worldBtnNormal.width > 0) {
    draw(this.worldBtnNormal, worldBtnX, worldBtnY);
  }
  const minBtnW = this.btMin?.width || 12;
  const minBtnH = this.btMin?.height || 12;
  const minBtnX = worldBtnX - minBtnW - 3;
  const minBtnY = worldBtnY;
  if (this.btMin && this.btMin.width > 0) {
    draw(this.btMin, minBtnX, minBtnY);
  }

  // Map mark icon. Going through draw() is what matters here: the mark is one
  // of ~66 sprites decoded in one go at startup, so it is the piece most likely
  // to still be undecoded on the first build. Skipping it silently baked an
  // iconless header into the cache for the rest of the map — draw() flags the
  // miss instead, and render() rebuilds until it lands.
  const markX = nwW + 7;
  const markY = 20;
  const markW = this.mapMark ? MAP_MARK_SIZE : 0;
  if (this.mapMark) {
    ctx.strokeStyle = '#8e8e8e';
    ctx.lineWidth = 1;
    ctx.strokeRect(markX - 0.5, markY - 0.5, markW + 1, MAP_MARK_SIZE + 1);
    draw(this.mapMark, markX, markY);
  }

  // Street name and map name
  const nameX = markX + markW + 10;
  if (MapleMap.names) {
    const streetName = MapleMap.names.streetName || '';
    const mapName = MapleMap.names.mapName || '';
    ctx.textBaseline = 'top';
    if (streetName && typeof streetName === 'string') {
      ctx.font = 'bold 13px Arial';
      ctx.fillStyle = '#000000';
      ctx.fillText(streetName, nameX, markY + 6);
    }
    if (mapName && typeof mapName === 'string') {
      ctx.font = '13px Arial';
      ctx.fillStyle = '#000000';
      ctx.fillText(mapName, nameX, markY + 22);
    }
  }

  // --- Minimap image area ---
  // Center the map image horizontally if the frame is wider than needed
  const mapDrawX = nwW + Math.floor((innerW - mapImgW) / 2);
  const mapDrawY = nwH + padY;

  // Dark background fills the entire inner area
  ctx.fillStyle = '#2a2a2a';
  ctx.fillRect(nwW, nwH, innerW, innerH);

  // Clip minimap image to inner area
  ctx.save();
  ctx.beginPath();
  ctx.rect(nwW, nwH, innerW, innerH);
  ctx.clip();
  // Draw minimap image scaled to fit the cap
  if (mapScale < 1) {
    ctx.drawImage(md.canvas, mapDrawX, mapDrawY, mapImgW, mapImgH);
  } else {
    draw(md.canvas, mapDrawX, mapDrawY);
  }

  // Draw static icons (portals, NPCs) — they don't move
  if (this.icons && MapleMap.portals) {
    const portalIcon = this.icons.portal;
    const cx = md.centerX;
    const cy = md.centerY;
    const mw = md.width;
    const mh = md.height;
    for (const portal of MapleMap.portals) {
      // Only portals visible in the world (regular=2, GM event=4, visible
      // scripted=7) get a minimap dot — invisible/touch/script triggers don't
      if (portal.type !== 2 && portal.type !== 4 && portal.type !== 7) continue;
      if (portal.toMap >= 999999999 && !portal.script) continue; // non-functional portals
      const px = mapDrawX + (portal.x + cx) * mapImgW / mw - (portalIcon.width || 4) / 2;
      const py = mapDrawY + (portal.y + cy) * mapImgH / mh - (portalIcon.height || 4) / 2;
      draw(portalIcon, px, py);
    }
  }

  if (this.icons && MapleMap.npcs) {
    const npcIcon = this.icons.npc;
    const cx = md.centerX;
    const cy = md.centerY;
    const mw = md.width;
    const mh = md.height;
    for (const npc of MapleMap.npcs) {
      if (!npc.x || npc.hide) continue;
      const nx = mapDrawX + (npc.x + cx) * mapImgW / mw - (npcIcon.width || 2) / 2;
      const ny = mapDrawY + ((npc.cy || npc.y || 0) + cy) * mapImgH / mh - (npcIcon.height || 4) / 2;
      draw(npcIcon, nx, ny);
    }
  }

  ctx.restore();

  // Store cache and layout. A partially-drawn cache is still used this frame
  // (better than a blank minimap) but flagged so the next frame rebuilds it
  // once the remaining sprites have decoded.
  this._cachedFrame = offscreen;
  this._cacheIncomplete = incomplete;
  this._cachedW = totalW;
  this._cachedH = totalH;
  this._layout = {
    bx: 5, by: 5,
    mapDrawX, mapDrawY,
    mapImgW, mapImgH,
    totalW, totalH,
    nwW, nwH, neW,
    innerW, innerH,
    worldBtnX, worldBtnY,
    worldBtnW, worldBtnH,
    minBtnX, minBtnY,
    minBtnW, minBtnH,
  };
};

UIMiniMap.update = function (_msPerTick: number) {
  // Nothing to update
};

UIMiniMap.render = function (canvas: GameCanvas, _camera: CameraInterface) {
  if (this.isHidden || !this.initialized || !this.frame || !this.mapData) return;

  // Build cache if needed (once per map, or again while sprites are still
  // decoding — otherwise a missing piece stays missing for the whole map)
  if (!this._cachedFrame || this._cacheIncomplete) {
    this._buildCache();
  }
  const L = this._layout;
  if (!this._cachedFrame || !L) return;

  // Collapsed state (v83): Min/w + stretched Min/c + Min/e strip sized to
  // the map name, with the [+] and [MAP] buttons at the right end
  if (this.viewMode === 'min' && this.minStrip) {
    const bx = L.bx, by = L.by;
    const { w, c, e } = this.minStrip;
    const ctx = canvas.context;

    const mapName = (typeof MapleMap.names?.mapName === 'string' && MapleMap.names.mapName) || '';
    ctx.font = 'bold 12px Arial';
    const textW = Math.ceil(ctx.measureText(mapName).width);

    const maxBtnW = this.btMax?.width || 12;
    const maxBtnH = this.btMax?.height || 12;
    const mapBtnW = this.worldBtnNormal?.width || 36;
    const mapBtnH = this.worldBtnNormal?.height || 12;

    const textX = bx + w.width + 2;
    const btnsW = maxBtnW + 3 + mapBtnW;
    const cW = 2 + textW + 8 + btnsW + 2;
    const stripH = c.height || 20;

    canvas.drawImage({ img: w, dx: bx, dy: by });
    ctx.drawImage(c, bx + w.width, by, cW, stripH);
    canvas.drawImage({ img: e, dx: bx + w.width + cW, dy: by });

    if (mapName) {
      ctx.save();
      ctx.font = 'bold 12px Arial';
      ctx.fillStyle = '#000000';
      ctx.textBaseline = 'middle';
      ctx.fillText(mapName, textX, by + Math.floor(stripH / 2) + 1);
      ctx.restore();
    }

    const btnY = by + Math.floor((stripH - maxBtnH) / 2);
    const maxBtnX = textX + textW + 8;
    const mapBtnX = maxBtnX + maxBtnW + 3;
    if (this.btMax && this.btMax.width > 0) {
      canvas.drawImage({ img: this.btMax, dx: maxBtnX, dy: btnY });
    }
    if (this.worldBtnNormal && this.worldBtnNormal.width > 0) {
      canvas.drawImage({ img: this.worldBtnNormal, dx: mapBtnX, dy: by + Math.floor((stripH - mapBtnH) / 2) });
    }

    this._minLayout = {
      btMaxX: maxBtnX, btMaxY: btnY, btMaxW: maxBtnW, btMaxH: maxBtnH,
      mapBtnX, mapBtnY: by + Math.floor((stripH - mapBtnH) / 2), mapBtnW, mapBtnH,
    };
    return;
  }

  const bx = L.bx;
  const by = L.by;

  // Draw the cached static frame as a single image
  canvas.drawImage({ img: this._cachedFrame, dx: bx, dy: by });

  // --- Draw dynamic icons (players move every frame) ---
  const md = this.mapData;
  const cx = md.centerX;
  const cy = md.centerY;
  const mw = md.width;
  const mh = md.height;
  const mapDrawX = bx + L.mapDrawX;
  const mapDrawY = by + L.mapDrawY;
  const mapImgW = L.mapImgW;
  const mapImgH = L.mapImgH;

  const worldToMiniX = (wx: number) => mapDrawX + (wx + cx) * mapImgW / mw;
  const worldToMiniY = (wy: number) => mapDrawY + (wy + cy) * mapImgH / mh;

  // Clip dynamic icons to the inner minimap area
  const ctx = canvas.context;
  ctx.save();
  ctx.beginPath();
  ctx.rect(bx + L.nwW, by + L.nwH, L.innerW, L.innerH);
  ctx.clip();

  // Draw other players
  if (this.icons && MapleMap.characters) {
    const otherIcon = this.icons.another;
    for (const chr of MapleMap.characters) {
      if (!chr.pos) continue;
      const ox = worldToMiniX(chr.pos.x) - (otherIcon.width || 3) / 2;
      const oy = worldToMiniY(chr.pos.y) - (otherIcon.height || 3) / 2;
      canvas.drawImage({ img: otherIcon, dx: ox, dy: oy });
    }
  }

  // Draw player icon (always visible)
  if (this.icons && MyCharacter.pos) {
    const userIcon = this.icons.user;
    const ux = worldToMiniX(MyCharacter.pos.x) - (userIcon.width || 3) / 2;
    const uy = worldToMiniY(MyCharacter.pos.y) - (userIcon.height || 3) / 2;
    canvas.drawImage({ img: userIcon, dx: ux, dy: uy });
  }

  ctx.restore();
};

UIMiniMap.handleClick = function (cx: number, cy: number): boolean {
  if (this.isHidden || !this._layout) return false;

  const hit = (x: number, y: number, w: number, h: number) =>
    cx >= x && cx <= x + w && cy >= y && cy <= y + h;

  // Collapsed strip: [+] restores the full map, [MAP] opens the world map
  if (this.viewMode === 'min') {
    const M = this._minLayout;
    if (!M) return false;
    if (hit(M.btMaxX, M.btMaxY, M.btMaxW, M.btMaxH)) {
      this.viewMode = 'max';
      return true;
    }
    if (hit(M.mapBtnX, M.mapBtnY, M.mapBtnW, M.mapBtnH)) {
      UIWorldMap.toggle(Number(MapleMap.mapId ?? 0));
      return true;
    }
    return false;
  }

  const L = this._layout;
  const bx = L.bx;
  const by = L.by;

  if (hit(bx + L.minBtnX, by + L.minBtnY, L.minBtnW, L.minBtnH)) {
    this.viewMode = 'min';
    return true;
  }

  if (hit(bx + L.worldBtnX, by + L.worldBtnY, L.worldBtnW, L.worldBtnH)) {
    UIWorldMap.toggle(Number(MapleMap.mapId ?? 0));
    return true;
  }

  return false;
};

export default UIMiniMap;
