import BASE64_HEADERS from "./base64headers";

/**
 * Represents a node in a WZ file.
 */
class WZNode {
  nParent: WZNode | null;
  nChildren: WZNode[];
  nTagName: string;
  nName: string;
  nValue: string | number | boolean | null | undefined;
  nBasedata: HTMLAudioElement | HTMLImageElement | string = "";

  /**
   * Creates an instance of WZNode.
   * @param obj - Object representing the WZNode.
   * @param nParent - Parent WZNode (default is null).
   */
  constructor(obj: any, nParent: WZNode | null = null) {
    this.nParent = nParent;
    this.nChildren = [];

    const isTag = (key: string) => key !== "$$" && key.charAt(0) === "$";
    const $tagName = Object.keys(obj).find(isTag);
    this.nTagName = $tagName ? $tagName.substr(1) : "";
    this.nName = obj[$tagName || ""] || "";

    Object.entries(obj).forEach(([key, value]: [string, any]) => {
      if (key.charAt(0) !== "$") {
        const nKey = `n${key.charAt(0).toUpperCase()}${key.substr(1)}`;
        // Only coerce genuinely numeric strings. isNaN("") is false, so the
        // old `isNaN(v) ? v : parseFloat(v)` turned every empty WZ string
        // into NaN — which then got interpolated straight into lookup paths
        // (e.g. a portal with image="" asked for .../psh/NaN/portalContinue)
        const numeric =
          typeof value === "string" && value.trim() !== "" && !isNaN(value as any);
        this[nKey as keyof this] = numeric ? parseFloat(value) : value;
      }
    });

    if (!!obj.$$) {
      obj.$$.forEach((childObj: any) => {
        const child = new WZNode(childObj, this);
        const childName = child.nName as keyof this;
        this[childName] = child as this[keyof this] & WZNode;
        this.nChildren.push(child);
      });
    }
  }

  nGet(key: string, defaultValue: WZNode = new WZNode({ $imgdir: "" })) {
    return key in this ? this[key as keyof this] : defaultValue;
  }

  nGetChild(childCallback: (node: WZNode) => boolean) {
    for (const child of this.nChildren) {
      if (!!childCallback(child)) {
        return child;
      }
    }
    return null;
  }

  nResolveUOL() {
    if (this.nTagName === "uol") {
      // Broken UOL paths resolve to undefined instead of throwing mid-walk
      let ret = `${this.nValue}`.split("/").reduce((pointer: any, pathName) => {
        return pathName === ".." ? pointer?.nParent : pointer?.[pathName];
      }, this.nParent);

      while (ret?.nTagName === "uol") {
        ret = ret.nResolveUOL();
      }

      return ret;
    }
  }

  nGetPath() {
    let ret = "";
    let pointer: WZNode | null = this;
    while (!!pointer) {
      ret = `${pointer.nName}/${ret}`;
      pointer = pointer.nParent;
    }
    return ret.slice(1, -1);
  }

  nGetAudio() {
    if (typeof this.nBasedata === "string") {
      this.nBasedata = new Audio(`${BASE64_HEADERS.MP3}${this.nBasedata}`);
    }
    return this.nBasedata;
  }

  nGetImage() {
    if (typeof this.nBasedata === "string") {
      const img = new Image();
      img.src = `${BASE64_HEADERS.PNG}${this.nBasedata}`;
      this.nBasedata = img;
    }
    return this.nBasedata;
  }

  /**
   * Creates and decodes this canvas node's image ahead of time. drawImage
   * skips images that haven't finished decoding, so a frame first drawn
   * lazily is invisible for its first few renders (sprite flicker). Safe
   * no-op on non-canvas nodes and already-decoded images.
   */
  nPreloadImage(): Promise<void> {
    if (this.nTagName !== "canvas") return Promise.resolve();
    const img = this.nGetImage();
    if (img instanceof HTMLImageElement && !img.complete) {
      return img.decode().catch(() => {});
    }
    return Promise.resolve();
  }
}

/**
 * Decode a whole animation's frames before anything tries to draw them.
 *
 * A one-shot effect reaches most of its frames for the very first time while
 * it is playing, so without this each new frame is created lazily, isn't
 * decoded yet, and gets skipped — the animation strobes on its first run.
 * Await this before starting an effect; fire-and-forget for looping sprites
 * that can afford to warm up over their first cycle.
 */
export function preloadFrames(frames: any): Promise<void> {
  if (!frames) return Promise.resolve();
  const list: any[] = Array.isArray(frames) ? frames : Array.from(frames);
  return Promise.all(
    list.map((f: any) => f?.nPreloadImage?.() ?? Promise.resolve())
  ).then(() => undefined);
}

export default WZNode;
