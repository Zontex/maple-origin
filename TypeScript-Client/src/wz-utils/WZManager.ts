import WZNode from "./WZNode";

// Prefixes that should stay cached permanently (shared across maps)
const PERSISTENT_PREFIXES = [
  'UI.wz/', 'String.wz/', 'Character.wz/', 'Base.wz/',
  'Sound.wz/', 'Skill.wz/', 'Item.wz/',
];

function isPersistent(filename: string): boolean {
  return PERSISTENT_PREFIXES.some(p => filename.startsWith(p));
}

/**
 * WZManager handles the loading and caching of WZ files.
 */
interface WZManager {
  cache: WZNode;
  _loadedFiles: Set<string>;
  _loading: Map<string, Promise<void>>;
  _doLoad: (filename: string) => Promise<void>;
  initialize: () => void;
  load: (filename: string) => Promise<void>;
  pathExists: (thePath: string) => boolean;
  get: (thePath: string) => Promise<WZNode | undefined>;
  unloadTransient: () => void;
}

const WZManager: WZManager = {
  /**
   * The cache to store loaded WZNode objects.
   */
  cache: new WZNode({ $dir: "" }),

  // Track loaded filenames for eviction
  _loadedFiles: new Set<string>(),

  /**
   * Initializes the WZManager by setting up the cache.
   */
  initialize() {
    this.cache = new WZNode({ $dir: "" });
    this._loadedFiles = new Set();
  },

  /**
   * Loads and caches a WZ file.
   *
   * @param filename - Relative path to WZ file.
   * @example WZManager.load('Map.wz/Map/Map1/100000000.img');
   * @example WZManager.load('Character.wz/Cap/01002357.img');
   */
  _loading: new Map<string, Promise<void>>(),

  async load(filename) {
    // Deduplicate concurrent loads of the same file
    if (this._loading.has(filename)) {
      return this._loading.get(filename);
    }
    const promise = this._doLoad(filename);
    this._loading.set(filename, promise);
    try { await promise; } finally { this._loading.delete(filename); }
  },

  async _doLoad(filename: string) {
    const json = await fetch(`wz_client/${filename}.json`).then((res) =>
      res.json()
    );

    let tree: any = this.cache;
    filename
      .split("/")
      .slice(0, -1)
      .forEach((p) => {
        if (!(p in tree)) {
          tree[p] = new WZNode({ $dir: p }, tree);
          tree.nChildren.push(tree[p]);
        }
        tree = tree[p];
      });

    const subtree = new WZNode(json, tree);
    tree[subtree.nName] = subtree;
    tree.nChildren.push(subtree);
    this._loadedFiles.add(filename);
  },

  /**
   * Checks if a WZ path exists in the cache.
   *
   * @param thePath - WZ path.
   * @returns True if path exists, false otherwise.
   */
  pathExists(thePath) {
    let tree: any = this.cache;
    for (const p of thePath.split("/")) {
      if (tree === undefined || tree[p] === undefined) {
        return false;
      }
      tree = tree[p];
    }
    return true;
  },

  /**
   * Gets a WZNode from the cache based on the provided path.
   * If the path doesn't exist, it loads the corresponding WZ file.
   *
   * @param thePath - WZ path.
   * @returns The WZNode if found, undefined otherwise.
   */
  async get(thePath) {
    if (!this.pathExists(thePath)) {
      const filename = `${thePath.split(".img")[0]}.img`;
      await this.load(filename);
    }
    let tree: any = this.cache;
    for (const p of thePath.split("/")) {
      tree = tree[p];
    }
    return tree;
  },

  /**
   * Unloads non-persistent (map-specific) assets from cache.
   * Call on map change to free memory from Mob.wz, Map.wz, Npc.wz sprites.
   */
  unloadTransient() {
    const evicted: string[] = [];
    for (const filename of this._loadedFiles) {
      if (isPersistent(filename)) continue;

      // Walk cache tree to the parent, remove the .img node
      const parts = filename.split("/");
      let tree: any = this.cache;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!tree[parts[i]]) break;
        tree = tree[parts[i]];
      }
      const leafName = parts[parts.length - 1];
      if (tree && tree[leafName]) {
        // Remove from parent's children array
        tree.nChildren = tree.nChildren.filter((c: any) => c.nName !== leafName);
        delete tree[leafName];
        evicted.push(filename);
      }
    }
    for (const f of evicted) {
      this._loadedFiles.delete(f);
    }
    if (evicted.length > 0) {
      console.log(`[WZManager] Evicted ${evicted.length} transient assets`);
    }
  },
};

export default WZManager;
