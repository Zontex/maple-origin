import WZManager from '../wz-utils/WZManager';
import GameCanvas from '../GameCanvas';
import { CameraInterface } from '../Camera';
import MapleMap from '../MapleMap';
import MyCharacter from '../MyCharacter';

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

  // Whether minimap is hidden
  isHidden: false,

  // Cached offscreen canvas for the static frame (rebuilt on map change)
  _cachedFrame: null as HTMLCanvasElement | null,
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
  } | null,
};

UIMiniMap.initialize = async function () {
  if (this.initialized) return;

  try {
    const uiWindow = await WZManager.get('UI.wz/UIWindow.img');
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

    const mapHelper = await WZManager.get('Map.wz/MapHelper.img');
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
  } catch (e) {
    console.error('[UIMiniMap] Failed to initialize:', e);
  }
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

    const markName = MapleMap.wzNode.info?.mapMark?.nValue;
    if (markName && this.marks[markName]) {
      this.mapMark = this.marks[markName];
      this.mapMarkName = markName;
    }

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

  const mapImgW = md.canvas.width || 0;
  const mapImgH = md.canvas.height || 0;
  if (mapImgW === 0 || mapImgH === 0) return;

  const nwW = fr.nw.width || 6;
  const nwH = fr.nw.height || 72;
  const neW = fr.ne.width || 6;
  const swH = fr.sw.height || 15;

  const padX = 7;
  const padY = 5;
  const innerW = Math.max(mapImgW + padX * 2, 120);
  const innerH = mapImgH + padY * 2;
  const totalW = nwW + innerW + neW;
  const totalH = nwH + innerH + swH;

  // Create offscreen canvas
  const offscreen = document.createElement('canvas');
  offscreen.width = totalW;
  offscreen.height = totalH;
  const ctx = offscreen.getContext('2d')!;

  // Helper to draw an image at (x, y)
  const draw = (img: HTMLImageElement, x: number, y: number) => {
    if (img && img.width > 0) ctx.drawImage(img, x, y);
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

  // WORLD button
  const worldBtnW = this.worldBtnNormal?.width || 36;
  const worldBtnH = this.worldBtnNormal?.height || 12;
  const worldBtnX = totalW - neW - worldBtnW - 4;
  const worldBtnY = 6;
  if (this.worldBtnNormal && this.worldBtnNormal.width > 0) {
    draw(this.worldBtnNormal, worldBtnX, worldBtnY);
  }

  // Map mark icon (38x38)
  const markX = nwW + 7;
  const markY = 20;
  if (this.mapMark && this.mapMark.width > 0) {
    ctx.strokeStyle = '#8e8e8e';
    ctx.lineWidth = 1;
    ctx.strokeRect(markX - 0.5, markY - 0.5, this.mapMark.width + 1, this.mapMark.height + 1);
    draw(this.mapMark, markX, markY);
  }

  // Street name and map name
  const markW = (this.mapMark && this.mapMark.width > 0) ? this.mapMark.width : 0;
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
  const mapDrawX = nwW + padX;
  const mapDrawY = nwH + padY;

  // Dark background behind the map image
  ctx.fillStyle = '#2a2a2a';
  ctx.fillRect(mapDrawX, mapDrawY, mapImgW, mapImgH);

  // Clip minimap image to inner area
  ctx.save();
  ctx.beginPath();
  ctx.rect(nwW, nwH, innerW, innerH);
  ctx.clip();
  draw(md.canvas, mapDrawX, mapDrawY);

  // Draw static icons (portals, NPCs) — they don't move
  if (this.icons && MapleMap.portals) {
    const portalIcon = this.icons.portal;
    const cx = md.centerX;
    const cy = md.centerY;
    const mw = md.width;
    const mh = md.height;
    for (const portal of MapleMap.portals) {
      if (portal.type === 0) continue;
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
      if (!npc.x) continue;
      const nx = mapDrawX + (npc.x + cx) * mapImgW / mw - (npcIcon.width || 2) / 2;
      const ny = mapDrawY + ((npc.cy || npc.y || 0) + cy) * mapImgH / mh - (npcIcon.height || 4) / 2;
      draw(npcIcon, nx, ny);
    }
  }

  ctx.restore();

  // Store cache and layout
  this._cachedFrame = offscreen;
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
  };
};

UIMiniMap.update = function (_msPerTick: number) {
  // Nothing to update
};

UIMiniMap.render = function (canvas: GameCanvas, _camera: CameraInterface) {
  if (this.isHidden || !this.initialized || !this.frame || !this.mapData) return;

  // Build cache if needed (once per map)
  if (!this._cachedFrame) {
    this._buildCache();
    if (!this._cachedFrame || !this._layout) return;
  }

  const L = this._layout;
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

  const L = this._layout;
  const bx = L.bx;
  const by = L.by;
  const wbx = bx + L.worldBtnX;
  const wby = by + L.worldBtnY;

  if (cx >= wbx && cx <= wbx + L.worldBtnW && cy >= wby && cy <= wby + L.worldBtnH) {
    console.log('[UIMiniMap] World map button clicked');
    return true;
  }

  return false;
};

export default UIMiniMap;
