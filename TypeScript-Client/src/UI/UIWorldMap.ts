/**
 * v83 World Map — the window behind the minimap's WORLD button.
 *
 * Everything comes out of the WZ. `Map.wz/WorldMap/WorldMap<nnn>.img` holds one
 * region each:
 *
 *   info/parentMap  the region to go back out to (absent on the root)
 *   BaseImg/0       the painted map, 640x470, its origin marking the centre
 *                   every other coordinate in the file is measured from
 *   MapList/<n>     a place on that map: `spot` offset from the origin, `type`
 *                   picking one of four marker sprites, `mapNo/<i>` listing the
 *                   map ids that belong to it (which is how the "you are here"
 *                   marker finds its spot), and on dungeons a title/desc
 *   MapLink/<n>     a region you can click into: `toolTip`, `link/linkMap` for
 *                   the file to open, and `link/linkImg` — the artwork drawn
 *                   over the base map while the cursor is inside it
 *
 * Markers are `Map.wz/MapHelper.img/worldMap`: mapImage/0-3 by spot type, and
 * curPos as a four-frame blink for the player's own position.
 */
import WZManager from '../wz-utils/WZManager';
import GameCanvas from '../GameCanvas';
import { CameraInterface } from '../Camera';
import config from '../Config';
// Deliberately no MapleMap import: MapleMap imports UIMiniMap, which imports
// this module to open the window. Reaching back for MapleMap.mapId closed the
// cycle MapleMap -> UIMiniMap -> UIWorldMap -> MapleMap, and the binding was
// dead by the time a click ran — the WORLD button did nothing at all. The map
// id is passed in by the callers, both of which already hold MapleMap.

const BASE_W = 640;
const BASE_H = 470;
// Border pieces: 0/1/2 cap and tile the title bar, 3/4 are the side edges,
// 5/6/7 the foot. The content sits in the middle at the base image's size.
const EDGE_W = 7;
const TITLE_H = 33;
const FOOT_H = 18;
const WIN_W = EDGE_W + BASE_W + EDGE_W;
const WIN_H = TITLE_H + BASE_H + FOOT_H;
const CURPOS_MS = 350;

/**
 * Which region file to try for a given map id, best guess first. The common
 * case — a Victoria Island map opening Victoria Island — hits on the first
 * probe, so opening the window costs one file load rather than a sweep of all
 * 27. Anything unmatched falls through to the full list.
 */
const REGION_HINTS: Array<[(id: number) => boolean, string[]]> = [
  [(id) => id < 100000000, ['WorldMap000']],
  [(id) => id < 200000000, ['WorldMap010', 'WorldMap011', 'WorldMap012', 'WorldMap013', 'WorldMap014']],
  [(id) => id < 300000000, ['WorldMap020', 'WorldMap021', 'WorldMap030', 'WorldMap031', 'WorldMap032',
                            'WorldMap040', 'WorldMap050', 'WorldMap051', 'WorldMap060', 'WorldMap070',
                            'WorldMap080', 'WorldMap090', 'WorldMap100']],
  [(id) => id < 700000000, ['WorldMap140', 'WorldMap141', 'WorldMap142']],
  [() => true, ['WorldMap210', 'WorldMap211', 'WorldMap220', 'WorldMap230']],
];

const ALL_REGIONS = [
  'WorldMap000', 'WorldMap010', 'WorldMap011', 'WorldMap012', 'WorldMap013', 'WorldMap014',
  'WorldMap020', 'WorldMap021', 'WorldMap030', 'WorldMap031', 'WorldMap032', 'WorldMap040',
  'WorldMap050', 'WorldMap051', 'WorldMap060', 'WorldMap070', 'WorldMap080', 'WorldMap090',
  'WorldMap100', 'WorldMap140', 'WorldMap141', 'WorldMap142', 'WorldMap210', 'WorldMap211',
  'WorldMap220', 'WorldMap230',
];

/**
 * A marker plus its WZ origin. Origin is not decoration here: the four curPos
 * frames are identical 17x35 pins whose origin walks 42 -> 40 -> 38 -> 36, and
 * that is the whole animation — the pin bobs while its point stays nailed to
 * the spot. Anchoring by sprite height instead drew it low and perfectly still.
 */
interface Sprite {
  img: HTMLImageElement;
  ox: number;
  oy: number;
}

interface Spot {
  x: number;
  y: number;
  type: number;
  mapNos: number[];
  title: string;
  desc: string;
}

interface Link {
  toolTip: string;
  linkMap: string;
  img: HTMLImageElement | null;
  /** Top-left of the link artwork, in base-image space */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Lazily built alpha mask, so an irregular region only claims its own shape */
  mask?: Uint8ClampedArray | null;
}

/**
 * Whether the cursor is on the artwork rather than merely inside its box.
 * Regions are drawn as ragged coastlines and their boxes overlap badly — on the
 * world view, Victoria Island's box covers most of Ossyria's — so a box test
 * would hand the click to whichever region happened to be listed first.
 */
function hitLink(link: Link, lx: number, ly: number): boolean {
  if (lx < 0 || ly < 0 || lx >= link.w || ly >= link.h) return false;
  if (link.mask === undefined) {
    link.mask = null;
    const img = link.img;
    if (img && img.complete && img.naturalWidth > 0) {
      try {
        const off = document.createElement('canvas');
        off.width = link.w;
        off.height = link.h;
        const octx = off.getContext('2d', { willReadFrequently: true })!;
        octx.drawImage(img, 0, 0);
        const data = octx.getImageData(0, 0, link.w, link.h).data;
        const mask = new Uint8ClampedArray(link.w * link.h);
        for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4 + 3];
        link.mask = mask;
      } catch {
        link.mask = null; // tainted or zero-sized — fall back to the box
      }
    } else {
      link.mask = undefined; // not decoded yet, try again next frame
      return true;
    }
  }
  if (!link.mask) return true;
  return link.mask[Math.floor(ly) * link.w + Math.floor(lx)] > 8;
}

interface Region {
  name: string;
  parentMap: string;
  base: HTMLImageElement | null;
  originX: number;
  originY: number;
  spots: Spot[];
  links: Link[];
}

const UIWorldMap = {
  isVisible: false,
  x: 0,
  y: 0,
  region: null as Region | null,
  border: null as HTMLImageElement[] | null,
  titleImg: null as HTMLImageElement | null,
  markers: null as { spot: Sprite[]; curPos: Sprite[] } | null,
  closeBtn: null as HTMLImageElement | null,
  _cache: new Map<string, Region>(),
  _loading: false,
  _initialized: false,
  _clickHeld: false,
  _windowDrag: null as { dx: number; dy: number } | null,
  _hoverLink: null as Link | null,
  _hoverSpot: null as Spot | null,
  _curPosFrame: 0,
  _curPosDelay: 0,
  /** Player's map, handed in by the caller — see the import note above */
  currentMapId: 0,

  initialize: undefined as unknown as (canvas: GameCanvas) => Promise<void>,
  doUpdate: undefined as unknown as (canvas: GameCanvas) => void,
  draw: undefined as unknown as (
    canvas: GameCanvas, camera: CameraInterface, lag: number, msPerTick: number,
    tdelta: number, mapId?: number
  ) => void,
  show: undefined as unknown as (mapId?: number) => void,
  hide: undefined as unknown as () => void,
  toggle: undefined as unknown as (mapId?: number) => void,
  openRegion: undefined as unknown as (name: string) => Promise<void>,
  goToParent: undefined as unknown as () => void,
  escape: undefined as unknown as () => void,
  loadRegion: undefined as unknown as (name: string) => Promise<Region | null>,
  regionFor: undefined as unknown as (mapId: number) => Promise<string>,
  containsPoint: undefined as unknown as (x: number, y: number) => boolean,
};

/** Whether a screen point lands on the window, for swallowing clicks. */
UIWorldMap.containsPoint = function (x: number, y: number): boolean {
  return (
    this.isVisible &&
    x >= this.x && x <= this.x + WIN_W &&
    y >= this.y && y <= this.y + WIN_H
  );
};

UIWorldMap.initialize = async function (_canvas: GameCanvas) {
  if (this._initialized) return;
  this._initialized = true;
  try {
    const win: any = await WZManager.get('UI.wz/UIWindow.img/WorldMap');
    this.border = [];
    for (let i = 0; i < 8; i++) {
      this.border.push(win.nGet('Border').nGet(String(i)).nGetImage());
    }
    this.titleImg = win.nGet('title').nGetImage();

    const helper: any = await WZManager.get('Map.wz/MapHelper.img/worldMap');
    const sprites = (setName: string): Sprite[] => {
      const set: Sprite[] = [];
      for (let i = 0; i < 4; i++) {
        const node = helper.nGet(setName).nGet(String(i));
        set.push({
          img: node.nGetImage(),
          ox: node.nGet('origin').nGet('nX', 0),
          oy: node.nGet('origin').nGet('nY', 0),
        });
      }
      return set;
    };
    this.markers = { spot: sprites('mapImage'), curPos: sprites('curPos') };

    const basic: any = await WZManager.get('UI.wz/Basic.img');
    this.closeBtn = basic.nGet('BtClose').nGet('normal').nGet('0').nGetImage();

    this.x = Math.floor((config.width - WIN_W) / 2);
    this.y = Math.floor((config.height - WIN_H) / 2);
  } catch (e) {
    console.error('[UIWorldMap] Failed to initialize:', e);
  }
};

UIWorldMap.loadRegion = async function (name: string): Promise<Region | null> {
  const cached = this._cache.get(name);
  if (cached) return cached;
  try {
    const node: any = await WZManager.get(`Map.wz/WorldMap/${name}.img`);
    if (!node) return null;

    const baseNode = node.nGet('BaseImg').nGet('0');
    const region: Region = {
      name,
      parentMap: node.nGet('info').nGet('parentMap').nGet('nValue', ''),
      base: baseNode.nGetImage(),
      originX: baseNode.nGet('origin').nGet('nX', BASE_W / 2),
      originY: baseNode.nGet('origin').nGet('nY', BASE_H / 2),
      spots: [],
      links: [],
    };

    for (const entry of node.nGet('MapList').nChildren) {
      const spotVec = entry.nGet('spot');
      const mapNos: number[] = [];
      for (const m of entry.nGet('mapNo').nChildren) {
        const v = Number(m.nGet('nValue', 0));
        if (Number.isFinite(v) && v > 0) mapNos.push(v);
      }
      region.spots.push({
        x: spotVec.nGet('nX', 0),
        y: spotVec.nGet('nY', 0),
        type: entry.nGet('type').nGet('nValue', 0),
        mapNos,
        title: entry.nGet('title').nGet('nValue', ''),
        desc: entry.nGet('desc').nGet('nValue', ''),
      });
    }

    for (const entry of node.nGet('MapLink').nChildren) {
      const linkNode = entry.nGet('link');
      const imgNode = linkNode.nGet('linkImg');
      const img = imgNode?.nGetImage?.() ?? null;
      // Link artwork carries its own origin, measured the same way the base
      // image's is: subtract it from the base origin to land the top-left.
      const ox = imgNode?.nGet?.('origin')?.nGet?.('nX', 0) ?? 0;
      const oy = imgNode?.nGet?.('origin')?.nGet?.('nY', 0) ?? 0;
      region.links.push({
        toolTip: entry.nGet('toolTip').nGet('nValue', ''),
        linkMap: linkNode.nGet('linkMap').nGet('nValue', ''),
        img,
        x: region.originX - ox,
        y: region.originY - oy,
        // WZ dimensions, not the HTMLImageElement's — an image that has not
        // decoded yet reports 0 and the region would be unclickable
        w: imgNode?.nWidth ?? img?.width ?? 0,
        h: imgNode?.nHeight ?? img?.height ?? 0,
      });
    }

    this._cache.set(name, region);
    return region;
  } catch (e) {
    console.error(`[UIWorldMap] Failed to load ${name}:`, e);
    return null;
  }
};

UIWorldMap.regionFor = async function (mapId: number): Promise<string> {
  const tried = new Set<string>();
  const order: string[] = [];
  for (const [test, names] of REGION_HINTS) {
    if (test(mapId)) { order.push(...names); break; }
  }
  for (const n of ALL_REGIONS) if (!order.includes(n)) order.push(n);

  for (const name of order) {
    if (tried.has(name)) continue;
    tried.add(name);
    const region = await this.loadRegion(name);
    if (region?.spots.some((s: Spot) => s.mapNos.includes(mapId))) return name;
  }
  // Nothing claims this map (hidden test maps, PQ instances) — show the world
  return 'WorldMap';
};

UIWorldMap.openRegion = async function (name: string) {
  if (this._loading) return;
  this._loading = true;
  try {
    const region = await this.loadRegion(name);
    if (region) this.region = region;
  } finally {
    this._loading = false;
  }
};

UIWorldMap.goToParent = function () {
  const parent = this.region?.parentMap;
  if (parent) void this.openRegion(parent);
};

/**
 * ESC steps out one region rather than closing outright — Maple Island opens
 * out to the whole of Maple World, and from there you can click into any other
 * island. Only the root has nowhere left to go, so that is where ESC closes.
 * Right-click does the same thing; the X and the WORLD button always close.
 */
UIWorldMap.escape = function () {
  if (this.region?.parentMap) this.goToParent();
  else this.hide();
};

UIWorldMap.show = function (mapId?: number) {
  this.isVisible = true;
  this._clickHeld = true; // swallow the press that opened the window
  if (mapId !== undefined) this.currentMapId = Number(mapId) || 0;
  const here = this.currentMapId;
  void (async () => {
    const name = await this.regionFor(here);
    await this.openRegion(name);
  })();
};

UIWorldMap.hide = function () {
  this.isVisible = false;
  this._windowDrag = null;
  this._hoverLink = null;
  this._hoverSpot = null;
};

UIWorldMap.toggle = function (mapId?: number) {
  if (this.isVisible) this.hide();
  else this.show(mapId);
};

UIWorldMap.doUpdate = function (canvas: GameCanvas) {
  if (!this.isVisible) return;
  const mx = canvas.mouseX;
  const my = canvas.mouseY;
  const contentX = this.x + EDGE_W;
  const contentY = this.y + TITLE_H;

  // A drag in progress owns the mouse
  if (this._windowDrag) {
    if (canvas.clicked) {
      this.x = mx - this._windowDrag.dx;
      this.y = my - this._windowDrag.dy;
      this.x = Math.max(-WIN_W + 80, Math.min(config.width - 80, this.x));
      this.y = Math.max(0, Math.min(config.height - TITLE_H, this.y));
      return;
    }
    this._windowDrag = null;
    this._clickHeld = false;
    return;
  }

  // Hover: links first, they sit over the spots
  this._hoverLink = null;
  this._hoverSpot = null;
  const region: Region | null = this.region;
  if (region) {
    for (const link of region.links) {
      if (hitLink(link, mx - (contentX + link.x), my - (contentY + link.y))) {
        this._hoverLink = link;
        break;
      }
    }
    if (!this._hoverLink) {
      for (const spot of region.spots) {
        const marker = this.markers?.spot[spot.type];
        const w = marker?.img?.width || 12;
        const h = marker?.img?.height || 12;
        const sx = contentX + region.originX + spot.x - (marker?.ox ?? w / 2);
        const sy = contentY + region.originY + spot.y - (marker?.oy ?? h / 2);
        if (mx >= sx && mx <= sx + w && my >= sy && my <= sy + h) {
          this._hoverSpot = spot;
          break;
        }
      }
    }
  }

  // Right-click steps back out of a region, the way clicking into one steps in
  if (canvas.rightClicked) {
    canvas.rightClicked = false;
    if (region?.parentMap) this.goToParent();
    else this.hide();
    return;
  }

  if (!canvas.clicked) {
    this._clickHeld = false;
    return;
  }
  if (this._clickHeld) return;
  this._clickHeld = true;

  // Close button, top-right of the title bar
  const closeW = this.closeBtn?.width || 13;
  const closeH = this.closeBtn?.height || 13;
  const closeX = this.x + WIN_W - EDGE_W - closeW - 4;
  const closeY = this.y + 7;
  if (mx >= closeX && mx <= closeX + closeW && my >= closeY && my <= closeY + closeH) {
    this.hide();
    return;
  }

  if (this._hoverLink?.linkMap) {
    void this.openRegion(this._hoverLink.linkMap);
    return;
  }

  // Title bar drags the window
  if (mx >= this.x && mx <= this.x + WIN_W && my >= this.y && my <= this.y + TITLE_H) {
    this._windowDrag = { dx: mx - this.x, dy: my - this.y };
  }
};

UIWorldMap.draw = function (canvas, _camera, _lag, msPerTick, _tdelta, mapId) {
  if (mapId !== undefined) this.currentMapId = Number(mapId) || 0;
  if (!this.isVisible || !this.border) return;

  const ctx = canvas.context;
  const b = this.border;
  const contentX = this.x + EDGE_W;
  const contentY = this.y + TITLE_H;

  // --- Frame: title row, side edges, foot ---
  canvas.drawImage({ img: b[0], dx: this.x, dy: this.y });
  ctx.drawImage(b[1], contentX, this.y, BASE_W, TITLE_H);
  canvas.drawImage({ img: b[2], dx: contentX + BASE_W, dy: this.y });
  ctx.drawImage(b[3], this.x, contentY, EDGE_W, BASE_H);
  ctx.drawImage(b[4], contentX + BASE_W, contentY, EDGE_W, BASE_H);
  canvas.drawImage({ img: b[5], dx: this.x, dy: contentY + BASE_H });
  ctx.drawImage(b[6], contentX, contentY + BASE_H, BASE_W, FOOT_H);
  canvas.drawImage({ img: b[7], dx: contentX + BASE_W, dy: contentY + BASE_H });

  if (this.titleImg) {
    canvas.drawImage({ img: this.titleImg, dx: this.x + 12, dy: this.y + 13 });
  }
  if (this.closeBtn) {
    canvas.drawImage({
      img: this.closeBtn,
      dx: this.x + WIN_W - EDGE_W - this.closeBtn.width - 4,
      dy: this.y + 7,
    });
  }

  const region: Region | null = this.region;
  if (!region) return;

  // --- The map itself ---
  if (region.base) canvas.drawImage({ img: region.base, dx: contentX, dy: contentY });

  // Hovered region lights up
  if (this._hoverLink?.img) {
    canvas.drawImage({
      img: this._hoverLink.img,
      dx: contentX + this._hoverLink.x,
      dy: contentY + this._hoverLink.y,
    });
  }

  // --- Spot markers ---
  const here = this.currentMapId;
  let hereSpot: Spot | null = null;
  for (const spot of region.spots) {
    const marker = this.markers?.spot[spot.type];
    if (marker?.img?.width) {
      canvas.drawImage({
        img: marker.img,
        dx: contentX + region.originX + spot.x - marker.ox,
        dy: contentY + region.originY + spot.y - marker.oy,
      });
    }
    if (!hereSpot && spot.mapNos.includes(here)) hereSpot = spot;
  }

  // --- "You are here", blinking through its four frames ---
  if (hereSpot && this.markers?.curPos?.length) {
    this._curPosDelay += msPerTick;
    if (this._curPosDelay >= CURPOS_MS) {
      this._curPosDelay = 0;
      this._curPosFrame = (this._curPosFrame + 1) % this.markers.curPos.length;
    }
    const cur = this.markers.curPos[this._curPosFrame];
    if (cur?.img?.width) {
      // Origin puts the pin's point on the spot; stepping through the frames'
      // origins is what makes it bob
      canvas.drawImage({
        img: cur.img,
        dx: contentX + region.originX + hereSpot.x - cur.ox,
        dy: contentY + region.originY + hereSpot.y - cur.oy,
      });
    }
  }

  // --- Hover label, drawn as plain outlined text like the original ---
  const label = this._hoverLink?.toolTip || this._hoverSpot?.title || '';
  if (label) {
    const lines = [label];
    if (this._hoverSpot?.desc) lines.push(this._hoverSpot.desc);
    lines.forEach((line, i) => {
      canvas.drawText({
        text: line,
        x: canvas.mouseX + 12,
        y: canvas.mouseY + 16 + i * 14,
        color: i === 0 ? '#ffffff' : '#cccccc',
        fontSize: i === 0 ? 12 : 11,
        fontWeight: i === 0 ? 'bold' : '',
        stroke: '#000000',
        strokeWidth: 3,
      });
    });
  }
};

export default UIWorldMap;
