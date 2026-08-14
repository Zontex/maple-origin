import GameCanvas from './GameCanvas';
import config from './Config';

/**
 * First-run asset downloader. Downloads the whole game-data set (WZ JSON,
 * scripts, data) into Cache Storage with a wait screen, then everything is
 * served cache-first (see cachedFetch) — no re-downloading on later runs,
 * and the same mechanism carries straight into a Capacitor build where the
 * cache lives inside the app.
 *
 * Resumable: files already in the cache are skipped, so an interrupted
 * download continues where it left off. Versioned: the manifest version
 * changes when assets change; old caches are dropped after a successful
 * re-download.
 */

const CACHE_PREFIX = 'maple-assets-';
const VERSION_KEY = 'maple:assets-version';
const CONCURRENCY = 12;

/**
 * Storage backends. Cache Storage is preferred but only exists in secure
 * contexts (https / localhost) — a phone on http://<lan-ip> doesn't have
 * it, so IndexedDB (available on insecure origins) is the fallback. A
 * Capacitor build is a secure context and uses Cache Storage.
 */
interface AssetStore {
  keys(): Promise<Set<string>>;
  get(path: string): Promise<Response | null>;
  put(path: string, res: Response): Promise<void>;
  dropOthers(): Promise<void>; // remove data from older versions
}

let activeStore: AssetStore | null = null;

class CacheStore implements AssetStore {
  constructor(private cache: Cache, private cacheName: string) {}
  static async open(version: string): Promise<CacheStore> {
    const name = CACHE_PREFIX + version;
    return new CacheStore(await caches.open(name), name);
  }
  async keys() {
    const out = new Set<string>();
    for (const req of await this.cache.keys()) {
      const u = new URL(req.url);
      out.add(decodeURIComponent(u.pathname).replace(/^\//, ''));
    }
    return out;
  }
  async get(path: string) {
    return (await this.cache.match(path)) ?? null;
  }
  async put(path: string, res: Response) {
    await this.cache.put(path, res);
  }
  async dropOthers() {
    for (const name of await caches.keys()) {
      if (name.startsWith(CACHE_PREFIX) && name !== this.cacheName) {
        await caches.delete(name);
      }
    }
  }
}

class IDBStore implements AssetStore {
  constructor(private db: IDBDatabase, private version: string) {}
  static open(version: string): Promise<IDBStore> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('maple-assets', 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('files');
      };
      req.onsuccess = () => resolve(new IDBStore(req.result, version));
      req.onerror = () => reject(req.error);
    });
  }
  private tx(mode: IDBTransactionMode) {
    return this.db.transaction('files', mode).objectStore('files');
  }
  private req<T>(r: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  private key(path: string) {
    return `${this.version}|${path}`;
  }
  async keys() {
    const all = (await this.req(this.tx('readonly').getAllKeys())) as string[];
    const prefix = `${this.version}|`;
    const out = new Set<string>();
    for (const k of all) if (k.startsWith(prefix)) out.add(k.slice(prefix.length));
    return out;
  }
  async get(path: string) {
    // Normalize absolute paths ("/scripts/x.js") to manifest-relative
    const rel = path.replace(/^\//, '');
    const entry: any = await this.req(this.tx('readonly').get(this.key(rel)));
    if (!entry) return null;
    return new Response(entry.body, { headers: { 'Content-Type': entry.type || 'application/octet-stream' } });
  }
  async put(path: string, res: Response) {
    const body = await res.blob();
    const type = res.headers.get('Content-Type') || '';
    await this.req(this.tx('readwrite').put({ body, type }, this.key(path)));
  }
  async dropOthers() {
    const all = (await this.req(this.tx('readonly').getAllKeys())) as string[];
    const prefix = `${this.version}|`;
    const stale = all.filter((k) => !k.startsWith(prefix));
    for (const k of stale) await this.req(this.tx('readwrite').delete(k));
  }
}

/** Cache-first fetch for game data. Falls back to the network (dev, or a
 *  file missing from an older manifest). */
export async function cachedFetch(url: string): Promise<Response> {
  if (activeStore) {
    const hit = await activeStore.get(url.replace(/^\//, ''));
    if (hit) return hit;
  }
  return fetch(url);
}

interface ManifestFile { p: string; s: number; }
interface Manifest { version: string; totalBytes: number; fileCount: number; files: ManifestFile[]; }

const AssetDownloader = {
  /**
   * Ensure assets are available locally. Fast no-op when the cached version
   * matches. Draws its own progress screen on the canvas while downloading.
   *
   * Enabled in production builds and under Capacitor; skipped in dev unless
   * localStorage 'maple:forcePreload' is set (dev serves from disk anyway).
   */
  async ensure(canvas: GameCanvas): Promise<void> {
    const isDev = (import.meta as any).env?.DEV === true;
    const forced = localStorage.getItem('maple:forcePreload') === '1';
    if (isDev && !forced) return;

    let manifest: Manifest;
    try {
      const res = await fetch('asset-manifest.json', { cache: 'no-cache' });
      if (!res.ok) return; // no manifest deployed — stream from network
      manifest = await res.json();
    } catch {
      return;
    }

    // Cache Storage in secure contexts; IndexedDB elsewhere (phone on
    // plain http LAN). Neither available → stream from network.
    let store: AssetStore;
    try {
      store = 'caches' in window
        ? await CacheStore.open(manifest.version)
        : await IDBStore.open(manifest.version);
    } catch (e) {
      console.warn('[Assets] no local storage backend, streaming from network', e);
      return;
    }
    activeStore = store;

    if (localStorage.getItem(VERSION_KEY) === manifest.version) {
      return; // already fully downloaded
    }

    // Keep the data across browser storage pressure where possible
    try { await navigator.storage?.persist?.(); } catch { /* best effort */ }

    // Resume support: only fetch what's missing
    const have = await store.keys();

    const todo = manifest.files.filter((f) => !have.has(f.p));
    let doneBytes = manifest.files.reduce(
      (acc, f) => acc + (have.has(f.p) ? f.s : 0), 0
    );
    let doneFiles = manifest.fileCount - todo.length;
    let failed = 0;

    const draw = () => {
      const w = config.width;
      const h = config.height;
      canvas.drawRect({ x: 0, y: 0, width: w, height: h, color: '#000000' });
      const pct = manifest.totalBytes > 0 ? doneBytes / manifest.totalBytes : 0;
      const mb = (doneBytes / 1048576).toFixed(0);
      const totalMb = (manifest.totalBytes / 1048576).toFixed(0);

      canvas.drawText({
        text: 'MapleOrigin',
        x: w / 2, y: h / 2 - 70, color: '#ffffff', fontSize: 28, align: 'center', fontWeight: 'bold',
      });
      canvas.drawText({
        text: 'Downloading game data — please wait',
        x: w / 2, y: h / 2 - 30, color: '#cccccc', fontSize: 14, align: 'center',
      });
      // Progress bar
      const barW = Math.floor(w * 0.5);
      const barX = Math.floor((w - barW) / 2);
      const barY = h / 2;
      canvas.drawRect({ x: barX, y: barY, width: barW, height: 18, color: '#222222' });
      canvas.drawRect({
        x: barX + 2, y: barY + 2, width: Math.max(0, Math.floor((barW - 4) * pct)), height: 14,
        color: '#33aaff',
      });
      canvas.drawText({
        text: `${(pct * 100).toFixed(1)}%  (${mb} / ${totalMb} MB · ${doneFiles}/${manifest.fileCount} files)`,
        x: w / 2, y: barY + 30, color: '#aaaaaa', fontSize: 12, align: 'center',
      });
      canvas.drawText({
        text: 'This happens once — the game starts instantly next time.',
        x: w / 2, y: barY + 56, color: '#777777', fontSize: 11, align: 'center',
      });
    };

    draw();
    // Repaint at ~10fps while downloading (main loop isn't running yet)
    const painter = setInterval(draw, 100);

    try {
      let index = 0;
      const worker = async () => {
        while (index < todo.length) {
          const file = todo[index++];
          const url = file.p;
          try {
            const res = await fetch(url);
            if (res.ok) {
              await store.put(url, res);
            } else {
              failed++;
            }
          } catch {
            failed++;
          }
          doneBytes += file.s;
          doneFiles++;
        }
      };
      await Promise.all(
        Array.from({ length: CONCURRENCY }, () => worker())
      );

      if (failed === 0) {
        localStorage.setItem(VERSION_KEY, manifest.version);
        await store.dropOthers();
      } else {
        console.warn(`[Assets] ${failed} files failed to download — will retry missing files next launch`);
      }
    } finally {
      clearInterval(painter);
    }
  },
};

export default AssetDownloader;
