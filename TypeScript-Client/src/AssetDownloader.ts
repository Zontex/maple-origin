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

let activeCache: Cache | null = null;

/** Cache-first fetch for game data. Falls back to the network (dev, or a
 *  file missing from an older manifest). */
export async function cachedFetch(url: string): Promise<Response> {
  if (activeCache) {
    const hit = await activeCache.match(url);
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
    if (!('caches' in window)) return; // very old browser — stream from network

    let manifest: Manifest;
    try {
      const res = await fetch('asset-manifest.json', { cache: 'no-cache' });
      if (!res.ok) return; // no manifest deployed — stream from network
      manifest = await res.json();
    } catch {
      return;
    }

    const cacheName = CACHE_PREFIX + manifest.version;
    const cache = await caches.open(cacheName);
    activeCache = cache;

    if (localStorage.getItem(VERSION_KEY) === manifest.version) {
      return; // already fully downloaded
    }

    // Keep the data across browser storage pressure where possible
    try { await navigator.storage?.persist?.(); } catch { /* best effort */ }

    // Resume support: only fetch what's missing
    const have = new Set<string>();
    for (const req of await cache.keys()) {
      const u = new URL(req.url);
      have.add(decodeURIComponent(u.pathname).replace(/^\//, ''));
    }

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
              await cache.put(url, res);
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
        // Drop caches from older versions
        for (const name of await caches.keys()) {
          if (name.startsWith(CACHE_PREFIX) && name !== cacheName) {
            await caches.delete(name);
          }
        }
      } else {
        console.warn(`[Assets] ${failed} files failed to download — will retry missing files next launch`);
      }
    } finally {
      clearInterval(painter);
    }
  },
};

export default AssetDownloader;
