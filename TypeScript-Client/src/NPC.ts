import WZManager from "./wz-utils/WZManager";
import Random from "./Random";
import GameCanvas from "./GameCanvas";
import { CameraInterface } from "./Camera";
import TaxiUI, { TaxiDestination } from "./UI/TaxiUI";
import QuestData from "./Quest/QuestData";

class NPC {
  opts: any;
  oId: number = 0;
  id: number = 0;
  x: number = 0;
  cy: number = 0;
  // Add pos property for consistent positioning with other entities
  pos: { x: number, y: number } = { x: 0, y: 0 };
  flipped: boolean = false;
  fh: any = null;
  rx0: number = 0;
  rx1: number = 0;
  npcFile: any = null;
  stances: any = {};
  strings: any = {};
  floating: number = 0;
  
  // NPC type flags
  isTaxi: boolean = false;
  taxiDestinations: TaxiDestination[] = [];

  // Quest indicator
  isQuestGiver: boolean = false;
  questIconAvailable: any[] = [];    // QuestIcon/0 frames (available)
  questIconInProgress: any[] = [];   // QuestIcon/1 frames (in progress)
  questIconCompletable: any[] = [];  // QuestIcon/2 frames (completable)
  questNotice0: any = null;          // balloon frame for available
  questNotice1: any = null;          // balloon frame for in-progress
  questIconFrame: number = 0;
  questIconDelay: number = 0;
  questIconNextDelay: number = 200;  // ms per frame

  // MapleTV
  mapleTv: number = 0;
  mapleTvAdX: number = 0;
  mapleTvAdY: number = 0;
  mapleTvMsgX: number = 0;
  mapleTvMsgY: number = 0;
  tvAdStances: any = [];
  tvAdStance: number = 0;
  tvAdFrame: number = 0;
  tvAdDelay: number = 0;
  tvAdNextDelay: number = 0;
  mapleTvMsgImg: any = null;

  // NPC stance frames
  stance: string = "stand";
  frame: number = 0;
  delay: number = 0;
  nextDelay: number = 0;

  // Control rendering order, if needed
  layer: number = 0;

  // Whether to display chat balloon
  showDialog: boolean = false;
  
  // Dialog timing to show NPCs talking periodically
  dialogTimer: number = 0;
  dialogInterval: number = 12000; // Show dialog every 12 seconds
  dialogDuration: number = 6000;  // Show dialog for 6 seconds
  lastDialogTime: number = 0;
  initialDelayPassed: boolean = false; // For staggering NPC dialogs

  // Chat balloon images from ChatBalloon.img
  // Typically, "ChatBalloon.img" has multiple styles: "0", "1", "2", etc.
  // We'll pick style "0" for demonstration.
  chatBalloon: any = null;

  static async fromOpts(opts: any) {
    const npc = new NPC(opts);
    await npc.load();
    return npc;
  }

  constructor(opts: any) {
    this.opts = opts;
  }

  async load() {
    const opts = this.opts;

    this.oId = opts.oId;
    this.id = opts.id;
    this.x = opts.x;
    this.cy = opts.cy;
    // Set the pos property to match x and cy for consistent use across the codebase
    this.pos = { x: opts.x, y: opts.cy };
    this.flipped = opts.f;
    this.fh = opts.fh;
    this.rx0 = opts.rx0;
    this.rx1 = opts.rx1;

    // Load NPC sprite data
    let strId = `${this.id}`.padStart(7, "0");
    let npcFile: any = await WZManager.get(`Npc.wz/${strId}.img`);
    if (!!npcFile.info.link) {
      // If there's a link, follow it
      const linkId = npcFile.info.link.nValue;
      strId = `${linkId}`.padStart(7, "0");
      npcFile = await WZManager.get(`Npc.wz/${strId}.img`);
    }
    this.npcFile = npcFile;

    // Gather stance frames
    this.stances = {};
    npcFile.nChildren
      .filter((c: any) => c.nName !== "info")
      .forEach((stance: any) => {
        this.stances[stance.nName] = this.loadStance(npcFile, stance.nName);
      });

    // Load NPC strings
    this.strings = await this.loadStrings(this.id);

    // Check for various places where NPC dialogue might be stored
    // 1. Check in the npcFile directly for "speak" property
    if (npcFile.nGet("speak")) {
      this.strings.speak = npcFile.nGet("speak").nGet("nValue", "Hello!");
    } 
    // 2. Check in the info section
    else if (npcFile.info && npcFile.info.nGet("speak")) {
      this.strings.speak = npcFile.info.nGet("speak").nGet("nValue", "Hello!");
    }
    // 3. Check if there's a chat or dialogue property
    else if (npcFile.nGet("chat")) {
      this.strings.speak = npcFile.nGet("chat").nGet("nValue", "Hello!");
    }
    else if (npcFile.info && npcFile.info.nGet("chat")) {
      this.strings.speak = npcFile.info.nGet("chat").nGet("nValue", "Hello!");
    }
    
    // If no speak property is found anywhere, try to generate a relevant dialogue
    if (!this.strings.speak && this.strings.name) {
      if (this.strings.func) {
        this.strings.speak = `Hello! I'm ${this.strings.name}. I can help you with ${this.strings.func}.`;
      } else {
        this.strings.speak = `Hello! I'm ${this.strings.name}. Welcome to MapleStory!`;
      }
    }

    // Check if this is a taxi NPC based on function or name
    if (this.strings.func && 
        (this.strings.func.toLowerCase().includes('taxi') || 
         this.strings.func.toLowerCase().includes('cab'))) {
      this.isTaxi = true;
      this.setupTaxiDestinations();
    } else if (this.strings.name && 
              (this.strings.name.toLowerCase().includes('taxi') || 
               this.strings.name.toLowerCase().includes('cab') ||
               this.strings.name.toLowerCase().includes('driver'))) {
      this.isTaxi = true;
      this.setupTaxiDestinations();
    } else if (this.id === 1022000) { // Special case: Henesys regular cab
      this.isTaxi = true;
      this.setupTaxiDestinations();
    }

    // Some NPCs "float"
    this.floating = npcFile.info.nGet("float").nGet("nValue", 0);

    // MapleTV logic
    this.mapleTv = npcFile.info.nGet("MapleTV").nGet("nValue", 0);
    if (!!this.mapleTv) {
      this.mapleTvAdX = npcFile.info.MapleTVadX.nValue;
      this.mapleTvAdY = npcFile.info.MapleTVadY.nValue;
      this.mapleTvMsgX = npcFile.info.MapleTVmsgX.nValue;
      this.mapleTvMsgY = npcFile.info.MapleTVmsgY.nValue;

      const tvFile: any = await WZManager.get("UI.wz/MapleTV.img");
      const tvMsg = tvFile.TVmedia;
      this.tvAdStances = tvMsg.nChildren.map((stance: any, i: number) => {
        return this.loadStance(tvMsg, i.toString());
      });
      this.setTvAdFrame(Random.randInt(0, this.tvAdStances.length - 1), 0);
      this.mapleTvMsgImg = tvFile.TVbasic[0].nGetImage();
    }

    // Load the ChatBalloon image from UI.wz
    // We'll use the "0" style for demonstration. 
    // (You can switch it to "1", "2", "3", etc., based on your preference.)
    const chatBalloonFile: any = await WZManager.get("UI.wz/ChatBalloon.img");
    const style0 = chatBalloonFile["0"]; // We'll reference style "0"

    // Store them in a small object for easy usage:
    this.chatBalloon = {
      nw: style0.nw.nGetImage(),
      ne: style0.ne.nGetImage(),
      sw: style0.sw.nGetImage(),
      se: style0.se.nGetImage(),
      n: style0.n.nGetImage(),
      s: style0.s.nGetImage(),
      w: style0.w.nGetImage(),
      e: style0.e.nGetImage(),
      c: style0.c.nGetImage(),
      arrow: style0.arrow.nGetImage(),
    };
    // Note: There's also style0.clr. That might be a color int. We'll ignore for now.

    // Load quest icon animation frames and balloon frames
    try {
      const questIconNode: any = await WZManager.get('UI.wz/UIWindow.img/QuestIcon');
      // QuestIcon/0 = available (frames 0-7)
      this.questIconAvailable = [];
      if (questIconNode?.[0]?.nChildren) {
        for (const child of questIconNode[0].nChildren) {
          if (child.nGetImage) this.questIconAvailable.push(child.nGetImage());
        }
      }
      // QuestIcon/1 = in progress (frames 0-3)
      this.questIconInProgress = [];
      if (questIconNode?.[1]?.nChildren) {
        for (const child of questIconNode[1].nChildren) {
          if (child.nGetImage) this.questIconInProgress.push(child.nGetImage());
        }
      }
      // QuestIcon/2 = completable (frames 0-7)
      this.questIconCompletable = [];
      if (questIconNode?.[2]?.nChildren) {
        for (const child of questIconNode[2].nChildren) {
          if (child.nGetImage) this.questIconCompletable.push(child.nGetImage());
        }
      }
      // note: Quest/notice0,notice1,notice2 are "no quests" messages, NOT balloon frames
    } catch (e) {
      // Ignore icon load failures
    }

    // Start with "stand" stance
    this.setFrame("stand", 0);
  }

  async loadStrings(id: number) {
    try {
      const stringFile: any = await WZManager.get("String.wz/Npc.img");
      const npcStrings = stringFile.nGet(id);
      
      if (!npcStrings || !npcStrings.nChildren) {
        console.warn(`No string data found for NPC ${id}`);
        return {};
      }
      
      const result: any = {};
      
      // Process all string properties
      for (const child of npcStrings.nChildren) {
        // Store basic properties like name and func
        result[child.nName] = child.nValue;
        
        // Look for dialogue patterns:
        // 'n0', 'n1', 'n2' etc. are normal chat messages NPCs say periodically
        if (child.nName.startsWith('n') && !isNaN(parseInt(child.nName.substring(1)))) {
          if (!result.dialogues) {
            result.dialogues = [];
          }
          result.dialogues.push(child.nValue);
        }
        
        // 'd0', 'd1', etc. are often quest-related dialogues
        if (child.nName.startsWith('d') && !isNaN(parseInt(child.nName.substring(1)))) {
          if (!result.questDialogues) {
            result.questDialogues = [];
          }
          result.questDialogues.push(child.nValue);
        }
      }
      
      // If we found dialogue lines, use the first one as the speak text
      if (result.dialogues && result.dialogues.length > 0) {
        result.speak = result.dialogues[0];
      }
      
      return result;
    } catch (e) {
      console.error(`Error loading strings for NPC ${id}:`, e);
      return {};
    }
  }

  // Define taxi destinations based on the current map and NPC's location
  // Replace the setupTaxiDestinations method in NPC.ts with this implementation

// Define taxi destinations based on the current map and NPC's location
setupTaxiDestinations() {
  // Clear existing destinations
  this.taxiDestinations = [];
  
  // Get the current map ID (ensure it's a number)
  const currentMapId = Number(this.opts?.map?.id || 0);
  
  console.log("Setting up taxi destinations for map ID:", currentMapId);
  
  // First digit of map ID determines region
  const firstDigit = Math.floor(currentMapId / 100000000);
  
  // Victoria Island Taxi destinations (100000000 series)
  if (firstDigit === 1) {
    // Default Victoria Island destinations
    const victoriaDestinations = [
      { mapId: 100000000, name: "Henesys", cost: 1000 },
      { mapId: 101000000, name: "Ellinia", cost: 1000 },
      { mapId: 102000000, name: "Perion", cost: 1000 },
      { mapId: 103000000, name: "Kerning City", cost: 1000 },
      { mapId: 104000000, name: "Lith Harbor", cost: 800 },
      { mapId: 120000000, name: "Nautilus Harbor", cost: 1200 }
    ];
    
    // Remove the current map from destinations
    this.taxiDestinations = victoriaDestinations.filter(dest => dest.mapId !== currentMapId);
  }
  // Ossyria Taxi destinations (200000000 series)
  else if (firstDigit === 2) {
    const ossyriaDestinations = [
      { mapId: 200000000, name: "Orbis", cost: 1200 },
      { mapId: 211000000, name: "El Nath", cost: 1200 },
      { mapId: 220000000, name: "Ludibrium", cost: 1200 },
      { mapId: 221000000, name: "Omega Sector", cost: 1500 },
      { mapId: 230000000, name: "Aquarium", cost: 1500 },
      { mapId: 240000000, name: "Leafre", cost: 1500 }
    ];
    
    // Remove the current map from destinations
    this.taxiDestinations = ossyriaDestinations.filter(dest => dest.mapId !== currentMapId);
  }
  // Default case: if we're in an unknown area, offer a mix of popular destinations
  else {
    this.taxiDestinations = [
      { mapId: 100000000, name: "Henesys", cost: 1500 },
      { mapId: 101000000, name: "Ellinia", cost: 1500 },
      { mapId: 102000000, name: "Perion", cost: 1500 },
      { mapId: 103000000, name: "Kerning City", cost: 1500 },
      { mapId: 104000000, name: "Lith Harbor", cost: 1500 },
      { mapId: 200000000, name: "Orbis", cost: 2000 }
    ];
  }
  
  // Always ensure we have at least one destination
  if (this.taxiDestinations.length === 0) {
    console.warn("No valid destinations found, adding default destinations");
    this.taxiDestinations = [
      { mapId: 100000000, name: "Henesys", cost: 1000 },
      { mapId: 104000000, name: "Lith Harbor", cost: 800 }
    ];
  }
  
  console.log("Taxi destinations set up:", this.taxiDestinations);
}
  
  // Handle taxi functionality when this NPC is clicked
  showTaxiDialog() {
    if (!this.isTaxi) return;

    const win = window as any;
    let gameCanvas = win.ClickManager?.GameCanvas || null;

    if (!gameCanvas && win.MapStateInstance?.doRender) {
      const doRenderOriginal = win.MapStateInstance.doRender;
      let capturedCanvas: any = null;

      win.MapStateInstance.doRender = function(canvas: any, ...args: any[]) {
        capturedCanvas = canvas;
        win.MapStateInstance.doRender = doRenderOriginal;
        doRenderOriginal.call(win.MapStateInstance, canvas, ...args);
      };

      setTimeout(() => {
        if (capturedCanvas) {
          this.continueTaxiDialog(capturedCanvas);
        } else {
          this.showDialog = true;
        }
      }, 50);
      return;
    }

    if (gameCanvas) {
      this.continueTaxiDialog(gameCanvas);
    } else {
      this.showDialog = true;
    }
  }

  continueTaxiDialog(gameCanvas: any) {
    if (!this.taxiDestinations || this.taxiDestinations.length === 0) {
      this.setupTaxiDestinations();
    }

    const win = window as any;
    if (win.TaxiUI) {
      try {
        if (!this.opts.map && win.MapStateInstance) {
          this.opts.map = win.MapStateInstance;
        }
        win.TaxiUI.show(gameCanvas, this.taxiDestinations, this.id, this.strings.name || 'Regular Cab');
        this.showDialog = false;
      } catch (error) {
        console.error("Error showing TaxiUI:", error);
        this.showDialog = true;
      }
    } else {
      this.showDialog = true;
    }
  }

  loadStance(wzNode: any = {}, stance: string = "stand") {
    if (!wzNode[stance]) {
      return { frames: [] };
    }
    const frames: any[] = [];
    wzNode[stance].nChildren.forEach((frame: any) => {
      if (frame.nTagName === "canvas" || frame.nTagName === "uol") {
        const Frame = frame.nTagName === "uol" ? frame.nResolveUOL() : frame;
        frames.push(Frame);
      } else {
        console.log(`Unhandled frame type=${frame.nTagName} stance=${stance}`);
      }
    });
    return { frames };
  }

  setFrame(stance = "stand", frame = 0, carryOverDelay = 0) {
    const s = this.stances[stance] ? stance : "stand";
    const f = this.stances[s].frames[frame] ? frame : 0;
    const stanceFrame = this.stances[s].frames[f];

    this.stance = s;
    this.frame = f;
    this.delay = carryOverDelay;
    this.nextDelay = stanceFrame.nGet("delay").nGet("nValue", 100);
  }

  setTvAdFrame(stance = 0, frame = 0, carryOverDelay = 0) {
    const s = this.tvAdStances[stance] ? stance : 0;
    const f = this.tvAdStances[s].frames[frame] ? frame : 0;
    const stanceFrame = this.tvAdStances[s].frames[f];

    this.tvAdStance = s;
    this.tvAdFrame = f;
    this.tvAdDelay = carryOverDelay;
    this.tvAdNextDelay = stanceFrame.nGet("delay").nGet("nValue", 100);
  }

  draw(canvas: GameCanvas, camera: CameraInterface, lag: number, msPerTick: number, tdelta: number) {
    // Draw the NPC's stance
    const currentFrame = this.stances[this.stance]?.frames[this.frame];
    if (!currentFrame) return;

    const currentImage = currentFrame.nGetImage();
    const originX = currentFrame.nGet("origin").nGet("nX", 0);
    const originY = currentFrame.nGet("origin").nGet("nY", 0);
    const adjustX = !this.flipped ? originX : currentFrame.nWidth - originX;

    canvas.drawImage({
      img: currentImage,
      dx: this.x - camera.x - adjustX,
      dy: this.cy - camera.y - originY,
      flipped: !!this.flipped,
    });

    // Name, func text
    this.drawName(canvas, camera, lag, msPerTick, tdelta);

    // Quest indicator above NPC
    this.drawQuestIndicator(canvas, camera);

    // MapleTV
    this.drawTvAd(canvas, camera, lag, msPerTick, tdelta);

    // Chat balloon
    if (this.showDialog) {
      this.drawChatBalloon(canvas, camera);
    }
  }

  drawQuestIndicator(canvas: GameCanvas, camera: CameraInterface) {
    const questManager = (window as any).charecter?.questManager;
    if (!questManager) return;

    const questIds = QuestData.npcToQuests.get(this.id);
    if (!questIds || questIds.length === 0) return;

    const quests = questManager.getQuestsForNpc(this.id);
    let frames: any[] = [];
    let balloon: any = null;

    if (quests.completable.length > 0) {
      frames = this.questIconCompletable;
      balloon = this.questNotice0;
    } else if (quests.available.length > 0) {
      frames = this.questIconAvailable;
      balloon = this.questNotice0;
    } else if (quests.inProgress.length > 0) {
      frames = this.questIconInProgress;
      balloon = this.questNotice1;
    }

    if (frames.length === 0) return;

    // Mark as quest giver and suppress NPC chat balloon
    this.isQuestGiver = true;
    this.showDialog = false;

    // Animate through frames
    const icon = frames[this.questIconFrame % frames.length];
    if (!icon) return;

    const npcScreenX = this.x - camera.x;
    const npcScreenY = this.cy - camera.y;

    if (balloon) {
      const bw = balloon.width;
      const bh = balloon.height;
      const bx = Math.round(npcScreenX - bw / 2);
      const by = Math.round(npcScreenY - bh - icon.height - 80);

      canvas.drawImage({ img: balloon, dx: bx, dy: by });

      const iconX = bx + Math.round((bw - icon.width) / 2);
      const iconY = by + Math.round((bh - icon.height) / 2) - 4;
      canvas.drawImage({ img: icon, dx: iconX, dy: iconY });
    } else {
      canvas.drawImage({
        img: icon,
        dx: Math.round(npcScreenX - icon.width / 2),
        dy: Math.round(npcScreenY - 120),
      });
    }
  }

  updateQuestIcon(msPerTick: number) {
    this.questIconDelay += msPerTick;
    if (this.questIconDelay >= this.questIconNextDelay) {
      this.questIconDelay -= this.questIconNextDelay;
      this.questIconFrame++;
    }
  }

  drawName(
    canvas: GameCanvas,
    camera: CameraInterface,
    lag: number,
    msPerTick: number,
    tdelta: number
  ) {
    const hideName = this.npcFile.info.nGet("hideName").nGet("nValue", 0);
    const hasName = !!this.strings.name;
    const hasFunc = !!this.strings.func;
    const tagHeight = 16;
    const tagPadding = 4;
    const tagColor = "#000000";
    const tagAlpha = 0.7;
    const offsetFromCy = 2;

    if (!hideName && hasName) {
      const nameOpts = {
        text: this.strings.name,
        x: this.x - camera.x,
        y: this.cy - camera.y + offsetFromCy + 3,
        color: "#ffff00",
        fontWeight: "bold",
        align: "center" as const,
      };
      const nameWidth = Math.ceil(canvas.measureText(nameOpts).width + tagPadding);
      const nameTagX = Math.ceil(this.x - camera.x - nameWidth / 2);

      canvas.drawRect({
        x: nameTagX,
        y: this.cy - camera.y + offsetFromCy,
        width: nameWidth,
        height: tagHeight,
        color: tagColor,
        alpha: tagAlpha,
      });
      canvas.drawText(nameOpts);
    }

    if (!hideName && hasFunc) {
      const funcOpts = {
        text: this.strings.func,
        x: this.x - camera.x,
        y: this.cy - camera.y + offsetFromCy + tagHeight + 4,
        color: "#ffff00",
        fontWeight: "bold",
        align: "center" as const,
      };
      const funcWidth = Math.ceil(canvas.measureText(funcOpts).width + tagPadding);
      const funcTagX = Math.ceil(this.x - camera.x - funcWidth / 2);

      canvas.drawRect({
        x: funcTagX,
        y: this.cy - camera.y + offsetFromCy + tagHeight + 1,
        width: funcWidth,
        height: tagHeight,
        color: tagColor,
        alpha: tagAlpha,
      });
      canvas.drawText(funcOpts);
    }
  }

  drawTvAd(
    canvas: GameCanvas,
    camera: CameraInterface,
    lag: number,
    msPerTick: number,
    tdelta: number
  ) {
    if (!this.mapleTv) return;

    const s = this.tvAdStance;
    const f = this.tvAdFrame;
    const currentFrame = this.tvAdStances[s]?.frames[f];
    if (!currentFrame) return;

    const currentImage = currentFrame.nGetImage();
    canvas.drawImage({
      img: currentImage,
      dx: this.x - camera.x + this.mapleTvAdX,
      dy: this.cy - camera.y + this.mapleTvAdY,
    });

    if (this.mapleTvMsgImg) {
      const msgX = this.x - camera.x + ((this.mapleTvMsgX - 0x10000) % 0x10000);
      const msgY = this.cy - camera.y + this.mapleTvMsgY;
      canvas.drawImage({
        img: this.mapleTvMsgImg,
        dx: msgX,
        dy: msgY,
      });
    }
  }

  // Draw MapleStory NPC overhead chat balloon using ChatBalloon.img 9-patch
  drawChatBalloon(canvas: GameCanvas, camera: CameraInterface) {
    if (!this.chatBalloon || !this.showDialog) return;

    // NPC world position → screen position
    const npcScreenX = this.x - camera.x;
    const npcScreenY = this.cy - camera.y;

    // Skip if NPC is off screen
    if (npcScreenX < -100 || npcScreenX > 900 || npcScreenY < -100 || npcScreenY > 700) return;

    // Get dialogue text
    let text = '';
    if (this.strings.dialogues && this.strings.dialogues.length > 0) {
      const idx = Math.floor(Date.now() / this.dialogDuration) % this.strings.dialogues.length;
      text = this.strings.dialogues[idx];
    } else if (this.strings.speak) {
      text = this.strings.speak;
    } else if (this.strings.name) {
      text = this.strings.func ? `I am ${this.strings.name}, the ${this.strings.func}.` : `I am ${this.strings.name}.`;
    } else {
      text = 'Hello!';
    }

    // Word-wrap text
    const maxTextW = 140;
    const fontSize = 12;
    const lineH = 14;
    const words = text.split(' ');
    const lines: string[] = [];
    let cur = '';
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (canvas.measureText({ text: test, fontSize }).width > maxTextW && cur) {
        lines.push(cur);
        cur = w;
      } else {
        cur = test;
      }
    }
    if (cur) lines.push(cur);

    // Measure balloon size
    let textW = 0;
    for (const l of lines) {
      textW = Math.max(textW, canvas.measureText({ text: l, fontSize }).width);
    }
    const textH = lines.length * lineH;

    const { nw, ne, sw, se, n, s, w, e, c, arrow } = this.chatBalloon;
    const nwW = nw.width, nwH = nw.height;
    const neW = ne.width;
    const swH = sw.height;
    const seW = se.width;
    const padX = 8, padY = 4;
    const innerW = Math.max(textW + padX * 2, 60);
    const innerH = Math.max(textH + padY * 2, 20);
    const totalW = nwW + innerW + neW;
    const totalH = nwH + innerH + swH;

    // Position: centered above NPC, anchored to world
    // cy is the NPC foot position, offset enough to clear the sprite + arrow
    const bx = Math.round(npcScreenX - totalW / 2);
    const by = Math.round(npcScreenY - totalH - 85);

    // Use canvas clip to properly tile 9-patch without overflow
    const ctx = canvas.context;
    ctx.save();

    // Draw corners
    canvas.drawImage({ img: nw, dx: bx, dy: by });
    canvas.drawImage({ img: ne, dx: bx + totalW - neW, dy: by });
    canvas.drawImage({ img: sw, dx: bx, dy: by + totalH - sw.height });
    canvas.drawImage({ img: se, dx: bx + totalW - seW, dy: by + totalH - se.height });

    // Top edge — clip to inner width
    ctx.save();
    ctx.beginPath();
    ctx.rect(bx + nwW, by, innerW, nwH);
    ctx.clip();
    for (let tx = bx + nwW; tx < bx + nwW + innerW; tx += n.width) {
      canvas.drawImage({ img: n, dx: tx, dy: by });
    }
    ctx.restore();

    // Bottom edge
    ctx.save();
    ctx.beginPath();
    ctx.rect(bx + nwW, by + totalH - s.height, innerW, s.height);
    ctx.clip();
    for (let tx = bx + nwW; tx < bx + nwW + innerW; tx += s.width) {
      canvas.drawImage({ img: s, dx: tx, dy: by + totalH - s.height });
    }
    ctx.restore();

    // Left edge
    ctx.save();
    ctx.beginPath();
    ctx.rect(bx, by + nwH, w.width, innerH);
    ctx.clip();
    for (let ty = by + nwH; ty < by + nwH + innerH; ty += w.height) {
      canvas.drawImage({ img: w, dx: bx, dy: ty });
    }
    ctx.restore();

    // Right edge
    ctx.save();
    ctx.beginPath();
    ctx.rect(bx + totalW - e.width, by + nwH, e.width, innerH);
    ctx.clip();
    for (let ty = by + nwH; ty < by + nwH + innerH; ty += e.height) {
      canvas.drawImage({ img: e, dx: bx + totalW - e.width, dy: ty });
    }
    ctx.restore();

    // Center fill
    ctx.save();
    ctx.beginPath();
    ctx.rect(bx + nwW, by + nwH, innerW, innerH);
    ctx.clip();
    for (let fy = by + nwH; fy < by + nwH + innerH; fy += c.height) {
      for (let fx = bx + nwW; fx < bx + nwW + innerW; fx += c.width) {
        canvas.drawImage({ img: c, dx: fx, dy: fy });
      }
    }
    ctx.restore();

    // Arrow pointing down to NPC
    canvas.drawImage({
      img: arrow,
      dx: Math.round(npcScreenX - arrow.width / 2),
      dy: by + totalH - 1,
    });

    ctx.restore();

    // Draw text
    const textStartY = by + nwH + padY;
    lines.forEach((line, i) => {
      canvas.drawText({
        text: line,
        x: bx + totalW / 2,
        y: textStartY + i * lineH,
        color: '#000000',
        align: 'center',
        fontSize,
        fontWeight: 'normal',
      });
    });
  }

  updateTvAd(msPerTick: number) {
    if (!!this.mapleTv) {
      this.tvAdDelay += msPerTick;
      if (this.tvAdDelay > this.tvAdNextDelay) {
        this.setTvAdFrame(
          this.tvAdStance,
          this.tvAdFrame + 1,
          this.tvAdDelay - this.tvAdNextDelay
        );
      }
    }
  }

  // In NPC.ts, replace the update method with this fixed version

update(msPerTick: number) {
  // Animate NPC stance
  this.delay += msPerTick;
  if (this.delay > this.nextDelay) {
    this.setFrame(this.stance, this.frame + 1, this.delay - this.nextDelay);
  }

  // Animate quest icon
  this.updateQuestIcon(msPerTick);

  // CRITICAL: Ensure position consistency for balloons
  this.pos.x = this.x;
  this.pos.y = this.cy;

  // MapleTV animation if present
  this.updateTvAd(msPerTick);
  
  // Global limit on how many NPCs can talk at once
  const MAX_TALKING_NPCS = 1; // Only allow one NPC to talk at a time
  
  // If this NPC is already showing a dialog, update its timer
  if (this.showDialog) {
    this.dialogTimer += msPerTick;
    
    // If we've shown dialog for long enough, hide it
    if (this.dialogTimer - this.lastDialogTime > this.dialogDuration) {
      this.showDialog = false;
      // Reset the timer for the next conversation
      this.dialogTimer = 0;
    }
    return; // Skip the rest of the logic if already showing dialog
  }
  
  // Skip dialog updates for taxi NPCs - they don't show automatic dialogue
  if (this.isTaxi) return;
  
  // Update dialog timer for NPCs with dialogue
  if (this.strings && (this.strings.speak || (this.strings.dialogues && this.strings.dialogues.length > 0))) {
    this.dialogTimer += msPerTick;
    
    // Add a random initial delay for each NPC to prevent all NPCs from talking at once
    if (!this.initialDelayPassed) {
      // Calculate a unique delay based on NPC ID to stagger conversations
      const initialDelay = 2000 + (this.id % 6) * 1000;
      if (this.dialogTimer > initialDelay) {
        this.initialDelayPassed = true;
        // Randomize the dialog timer so NPCs don't all get in sync
        this.dialogTimer = Math.random() * this.dialogInterval;
      }
      return;
    }
    
    // Check if dialog should be shown
    if (!this.showDialog) {
      // If we haven't shown dialog in a while, show it (only if we're allowed)
      if (this.dialogTimer > this.dialogInterval) {
        // Get all NPCs from the MapleMap
        // Skip showing dialog if we already have too many NPCs showing dialog
        const map = this.opts.map; // Access the map through the opts
        if (map && map.npcs) {
          const talkingNPCs = map.npcs.filter((npc: any) => npc.showDialog).length;
          if (talkingNPCs < MAX_TALKING_NPCS) {
            this.showDialog = true;
            this.lastDialogTime = this.dialogTimer;
          }
        } else {
          // If we can't check other NPCs, just show dialog
          this.showDialog = true;
          this.lastDialogTime = this.dialogTimer;
        }
      }
    }
  }
}
}

export default NPC;
