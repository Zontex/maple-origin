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
        this[nKey as keyof this] = isNaN(value) ? value : parseFloat(value);
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
      let ret = `${this.nValue}`.split("/").reduce((pointer: any, pathName) => {
        return pathName === ".." ? pointer!.nParent : pointer[pathName];
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
}

export default WZNode;
