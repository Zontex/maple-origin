import WZManager from '../wz-utils/WZManager';

/**
 * Guild emblem composition from UI.wz/GuildMark.img.
 *
 * The file holds two part families, each in 16 colour variants (child nodes
 * "1".."16"; "name" is the Korean part name):
 *   BackGround/0000<1000..1030>   17x17 frame shapes
 *   Mark/{Animal 2000.., Plant 3000.., Pattern 4000.., Letter 5000.., Etc 9000..}
 *                                 15x15 marks, drawn centred on the frame
 * An emblem is {bg, bgColor, mark, markColor} — Cosmic's logoBG / logoBGColor /
 * logo / logoColor — and 0 for either part means "none". Composites are
 * rendered once to a 17x17 offscreen canvas and cached by key; the getter is
 * synchronous (a miss kicks the load and returns null until it lands) so the
 * name-tag pass can call it every frame.
 */
export interface GuildEmblemSpec {
  bg: number;
  bgColor: number;
  mark: number;
  markColor: number;
}

export const EMBLEM_SIZE = 17;

const MARK_GROUPS: Record<number, string> = {
  2: 'Animal',
  3: 'Plant',
  4: 'Pattern',
  5: 'Letter',
  9: 'Etc',
};

const cache = new Map<string, HTMLCanvasElement | null>();
const pending = new Set<string>();
let markRoot: any = null;
let markRootPromise: Promise<any> | null = null;
let bgIds: number[] | null = null;
let markIds: number[] | null = null;

export function emblemKey(e: GuildEmblemSpec | null | undefined): string {
  if (!e) return '';
  return `${e.bg | 0}:${e.bgColor | 0}:${e.mark | 0}:${e.markColor | 0}`;
}

export function hasEmblem(e: GuildEmblemSpec | null | undefined): boolean {
  return !!e && ((e.bg | 0) > 0 || (e.mark | 0) > 0);
}

async function root(): Promise<any> {
  if (markRoot) return markRoot;
  if (!markRootPromise) {
    markRootPromise = WZManager.get('UI.wz/GuildMark.img').then((n: any) => {
      markRoot = n;
      return n;
    });
  }
  return markRootPromise;
}

function pad8(id: number): string {
  return String(id).padStart(8, '0');
}

function partNode(r: any, id: number, color: number): any {
  if (!id || !color) return null;
  const group = Math.floor(id / 1000);
  const dir = group === 1 ? r?.nGet?.('BackGround') : r?.nGet?.('Mark')?.nGet?.(MARK_GROUPS[group] ?? '');
  const part = dir?.nGet?.(pad8(id));
  const node = part?.nGet?.(String(color));
  return node?.nTagName === 'canvas' ? node : null;
}

async function compose(e: GuildEmblemSpec, key: string): Promise<void> {
  try {
    const r = await root();
    const bgNode = partNode(r, e.bg, e.bgColor);
    const markNode = partNode(r, e.mark, e.markColor);
    if (!bgNode && !markNode) {
      cache.set(key, null);
      return;
    }
    await Promise.all([bgNode?.nPreloadImage?.(), markNode?.nPreloadImage?.()]);
    const out = document.createElement('canvas');
    out.width = EMBLEM_SIZE;
    out.height = EMBLEM_SIZE;
    const ctx = out.getContext('2d');
    if (!ctx) {
      cache.set(key, null);
      return;
    }
    const draw = (node: any) => {
      if (!node) return;
      const img = node.nGetImage();
      if (!(img instanceof HTMLImageElement) || !img.width) return;
      ctx.drawImage(img, Math.floor((EMBLEM_SIZE - img.width) / 2), Math.floor((EMBLEM_SIZE - img.height) / 2));
    };
    draw(bgNode);
    draw(markNode);
    cache.set(key, out);
  } catch (err) {
    console.warn('[GuildEmblem] compose failed', e, err);
    cache.set(key, null);
  } finally {
    pending.delete(key);
  }
}

/** Composite for an emblem, or null while it loads / when it has no parts */
export function getEmblemImage(e: GuildEmblemSpec | null | undefined): HTMLCanvasElement | null {
  if (!hasEmblem(e)) return null;
  const key = emblemKey(e);
  if (cache.has(key)) return cache.get(key) ?? null;
  if (!pending.has(key)) {
    pending.add(key);
    void compose(e as GuildEmblemSpec, key);
  }
  return null;
}

/** Warm the GuildMark.img root so the designer's first frame has parts */
export async function preloadEmblemParts(): Promise<void> {
  const r = await root();
  if (!bgIds) {
    bgIds = (r?.nGet?.('BackGround')?.nChildren ?? [])
      .map((n: any) => Number(n.nName))
      .filter((n: number) => Number.isFinite(n))
      .sort((a: number, b: number) => a - b);
  }
  if (!markIds) {
    const ids: number[] = [];
    for (const group of Object.values(MARK_GROUPS)) {
      for (const n of r?.nGet?.('Mark')?.nGet?.(group)?.nChildren ?? []) {
        const id = Number(n.nName);
        if (Number.isFinite(id)) ids.push(id);
      }
    }
    markIds = ids.sort((a, b) => a - b);
  }
}

/** Background part ids in designer order (empty until preloadEmblemParts) */
export function backgroundIds(): number[] {
  return bgIds ?? [];
}

/** Mark part ids in designer order (empty until preloadEmblemParts) */
export function markPartIds(): number[] {
  return markIds ?? [];
}

export const EMBLEM_COLOR_COUNT = 16;
