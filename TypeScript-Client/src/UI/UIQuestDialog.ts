import WZManager from '../wz-utils/WZManager';
import UIAvatarStyleDialog from './UIAvatarStyleDialog';
import GameCanvas from '../GameCanvas';
import { CameraInterface } from '../Camera';
import { MapleStanceButton } from './MapleStanceButton';
import ClickManager from './ClickManager';
import QuestData, { QuestDialogue, ensureItemNames, ensureMapNames, resolveItemCodes } from '../Quest/QuestData';
import QuestManager from '../Quest/QuestManager';
import MapleInput from './MapleInput';
import type { ScriptDialogType } from '../Quest/QuestScriptEngine';
import type { SelectionOption } from '../NpcScriptEngine';
import config from '../Config';
import GUIUtil from '../GuiUtils';
import UIDevTools from './UIDevTools';

// UtilDlgEx known dimensions
const DIALOG_WIDTH = 529;
const TOP_H = 28;
const FILL_H = 20;
const BOTTOM_H = 58;
const LEFT_PADDING = 20;
const TEXT_LEFT = 166;
const TEXT_RIGHT_PAD = 20;
const TEXT_MAX_W = DIALOG_WIDTH - TEXT_LEFT - TEXT_RIGHT_PAD;
const LINE_H = 16;
const TEXT_TOP_OFFSET = 48;
// Gap between the NPC portrait and its name tag
const NAME_TAG_GAP = 2;

// Max lines of text that fit in the dialog before we need to paginate
const MAX_TEXT_LINES = 12;

type DialogPhase = 'start' | 'complete' | 'inProgress';

export default class UIQuestDialog {
  private utilDlgExNode: any = null;
  private questNode: any = null;
  private topImg: any = null;
  private fillImg: any = null;
  private bottomImg: any = null;
  private nameTagImg: any = null;
  private speakerImg: any = null;
  // The WZ node behind speakerImg — carries correct dimensions immediately,
  // whereas speakerImg.height is 0 until the sprite decodes
  private speakerNode: any = null;
  private basicNode: any = null;  // Basic.img — generic OK/Cancel/Yes/No buttons
  private listInProgressImg: HTMLImageElement | null = null;   // list0: "QUEST IN PROGRESS" (123x15)
  private listAvailableImg: HTMLImageElement | null = null;    // list1: "QUEST AVAILABLE" (105x18)
  private listEtcImg: HTMLImageElement | null = null;          // list2: etc bullet (19x12)
  private listCompletableImg: HTMLImageElement | null = null;  // list3: "QUEST THAT CAN BE COMPLETED" (179x14)
  // QuestIcon reward labels
  private rewardIcon: HTMLImageElement | null = null;     // QuestIcon/4/0: "REWARD!!"
  private expIcon: HTMLImageElement | null = null;        // QuestIcon/8/0: "EXP"
  private mesoIcon: HTMLImageElement | null = null;       // QuestIcon/7/0: "meso"
  private fameIcon: HTMLImageElement | null = null;       // QuestIcon/6/0: "fame"
  private itemIconCache: Map<number, HTMLImageElement | null> = new Map();
  private questIconCache: Map<string, HTMLImageElement | null> = new Map();
  isHidden: boolean = true;

  private buttons: MapleStanceButton[] = [];
  private questId: number = 0;
  private npcId: number = 0;
  private npcName: string = '';
  private phase: DialogPhase = 'start';
  private fillCount: number = 6;
  private x: number = 0;
  private y: number = 0;

  // All text pages (long text is split across pages)
  private pages: string[][] = []; // array of pages, each page is array of lines
  private currentPage: number = 0;
  private isLastPageShown: boolean = false;
  private accepted: boolean = false;

  // Static (WZ Say-driven) per-message flow: one Say message at a time, with
  // pages within a message and optional #L selections / quiz wrong answers
  private sayMessages: string[] = [];
  private sayOriginalIndices: number[] = []; // Say arrays are sparse; selections key on original index
  private messageIndex: number = 0;
  private quizReply: string | null = null;
  private selectionResolved: boolean = false;

  private onQuestAccepted: (() => void) | null = null;
  private onQuestCompleted: (() => void) | null = null;

  // Script mode
  private scriptMode: boolean = false;
  private scriptDialogType: ScriptDialogType = 'next';
  private scriptOnAction: ((mode: number, type: number, selection: number) => void) | null = null;
  private scriptQuestName: string = '';
  private selections: SelectionOption[] = [];
  private selectionRects: { index: number; x: number; y: number; w: number; h: number }[] = [];
  private hoveredSelection: number = -1;
  private selectedPropItem: { id: number; count: number } | null = null; // randomly picked from prop items
  // getText/getNumber input dialogs
  private scriptInput: MapleInput | null = null;
  private scriptInputOnInput: ((v: string) => void) | null = null;
  private scriptInputConfig: { def?: string | number; min?: number; max?: number } | null = null;

  // Temp canvas for text measurement
  private measureCanvas: GameCanvas | null = null;

  static async fromOpts() {
    const dialog = new UIQuestDialog();
    await dialog.load();
    return dialog;
  }

  async load() {
    this.utilDlgExNode = await WZManager.get('UI.wz/UIWindow.img/UtilDlgEx');
    this.questNode = await WZManager.get('UI.wz/UIWindow.img/Quest');
    this.basicNode = await WZManager.get('UI.wz/Basic.img');

    this.topImg = this.utilDlgExNode.t;
    this.fillImg = this.utilDlgExNode.c;
    this.bottomImg = this.utilDlgExNode.s;
    this.nameTagImg = this.utilDlgExNode.bar;

    // Load quest list header images from UtilDlgEx
    this.listInProgressImg = this.utilDlgExNode?.list0?.nGetImage?.() || null;
    this.listAvailableImg = this.utilDlgExNode?.list1?.nGetImage?.() || null;
    this.listEtcImg = this.utilDlgExNode?.list2?.nGetImage?.() || null;
    this.listCompletableImg = this.utilDlgExNode?.list3?.nGetImage?.() || null;

    // Load reward icons from QuestIcon — each is an imgdir with canvas children
    this.rewardIcon = await this.loadQuestIcon('4');  // REWARD!!
    this.expIcon = await this.loadQuestIcon('8');     // EXP
    this.mesoIcon = await this.loadQuestIcon('7');    // meso
    this.fameIcon = await this.loadQuestIcon('6');    // fame

    // Cache quest icons for inline rendering (used by #f codes in scripts)
    for (const id of ['3', '4', '5', '6', '7', '8', '9']) {
      const img = await this.loadQuestIcon(id);
      if (img) this.questIconCache.set(id, img);
    }
  }

  private async loadItemIcon(itemId: number): Promise<HTMLImageElement | null> {
    if (this.itemIconCache.has(itemId)) return this.itemIconCache.get(itemId) || null;
    try {
      const padded = `${itemId}`.padStart(8, '0');
      const category = Math.floor(itemId / 1000000);

      let node: any = null;
      if (category === 1) {
        // Equips are in Character.wz/<subfolder>/<paddedId>.img/info/icon
        const equipType = Math.floor(itemId / 10000);
        const subfolders: Record<number, string> = {
          100: 'Cap', 101: 'Accessory', 102: 'Accessory', 103: 'Accessory',
          104: 'Coat', 105: 'Longcoat', 106: 'Pants', 107: 'Shoes',
          108: 'Glove', 109: 'Shield', 110: 'Cape', 111: 'Ring',
          112: 'Ring', 113: 'Accessory', 114: 'Accessory',
          130: 'Weapon', 131: 'Weapon', 132: 'Weapon', 133: 'Weapon',
          137: 'Weapon', 138: 'Weapon', 139: 'Weapon', 140: 'Weapon',
          141: 'Weapon', 142: 'Weapon', 143: 'Weapon', 144: 'Weapon',
          145: 'Weapon', 146: 'Weapon', 147: 'Weapon', 148: 'Weapon',
          149: 'Weapon', 170: 'Weapon',
          190: 'TamingMob', 191: 'TamingMob', 192: 'TamingMob', 193: 'TamingMob',
        };
        const subfolder = subfolders[equipType] || 'Accessory';
        node = await WZManager.get(`Character.wz/${subfolder}/${padded}.img/info/icon`);
      } else {
        // Non-equips: Item.wz/<category>/<prefix>.img/<paddedId>/info/icon
        const prefix = padded.substring(0, 4);
        const categoryDir = category === 2 ? 'Consume' : category === 3 ? 'Install' : category === 4 ? 'Etc' : 'Cash';
        node = await WZManager.get(`Item.wz/${categoryDir}/${prefix}.img/${padded}/info/icon`);
      }

      const img = node?.nGetImage?.() || null;
      this.itemIconCache.set(itemId, img);
      return img;
    } catch {
      this.itemIconCache.set(itemId, null);
      return null;
    }
  }

  /** Kick off async loads for any \x01ITEM:id\x02 inline icons so draw() finds them in the cache */
  private preloadInlineIcons(texts: string[]) {
    for (const t of texts) {
      for (const m of t.matchAll(/\x01ITEM:(\d+)\x02/g)) {
        void this.loadItemIcon(parseInt(m[1]));
      }
    }
  }

  /** Return the ID of the randomly selected prop item (if any), for consistent quest completion */
  getSelectedPropItemId(): number | undefined {
    return this.selectedPropItem?.id;
  }

  /** Get display items for reward section — guaranteed items + one randomly picked prop item */
  private getDisplayRewardItems(reward: { items?: { id: number; count: number; prop?: number }[] }): { id: number; count: number }[] {
    if (!reward?.items) return [];
    const guaranteed = reward.items.filter(i => !i.prop || i.prop <= 0);
    const propItems = reward.items.filter(i => i.prop && i.prop > 0);
    if (propItems.length > 0) {
      // Weighted pick (cached so it stays consistent for this dialog showing)
      if (!this.selectedPropItem || !propItems.some(p => p.id === this.selectedPropItem!.id)) {
        const picked = QuestManager.pickWeightedPropItem(propItems);
        this.selectedPropItem = { id: picked.id, count: picked.count };
      }
      return [...guaranteed, this.selectedPropItem];
    }
    return guaranteed;
  }

  private async preloadRewardIcons() {
    if (!this.questId) return;
    const rewards = QuestData.rewards.get(this.questId);
    const reward = this.phase === 'complete' ? (rewards?.complete || rewards?.start) : (rewards?.start || rewards?.complete);
    if (reward?.items) {
      const displayItems = this.getDisplayRewardItems(reward);
      await Promise.all(displayItems.map(item => this.loadItemIcon(item.id)));
    }
  }

  private async loadQuestIcon(id: string): Promise<HTMLImageElement | null> {
    try {
      const node: any = await WZManager.get(`UI.wz/UIWindow.img/QuestIcon/${id}`);
      // The imgdir contains canvas children numbered 0, 1, etc. — get the first frame
      const frame = node?.nGet?.('0') || node?.[0];
      if (frame?.nGetImage) return frame.nGetImage();
      if (node?.nGetImage) return node.nGetImage();
      return null;
    } catch { return null; }
  }

  async show(opts: {
    questId: number;
    npcId: number;
    npcName: string;
    phase: DialogPhase;
    onAccepted?: () => void;
    onCompleted?: () => void;
  }) {
    this.questId = opts.questId;
    this.npcId = opts.npcId;
    this.npcName = opts.npcName;
    this.phase = opts.phase;
    this.onQuestAccepted = opts.onAccepted || null;
    this.onQuestCompleted = opts.onCompleted || null;
    this.currentPage = 0;
    this.accepted = false;
    this.selectedPropItem = null;
    this.scriptMode = false;
    this.messageIndex = 0;
    this.quizReply = null;
    this.selectionResolved = false;
    this.selections = [];
    this.selectionRects = [];

    // Load NPC sprite
    const strId = `${this.npcId}`.padStart(7, '0');
    let npcFile: any = await WZManager.get(`Npc.wz/${strId}.img`);
    if (npcFile?.info?.link) {
      const linkId = npcFile.info.link.nValue;
      npcFile = await WZManager.get(`Npc.wz/${`${linkId}`.padStart(7, '0')}.img`);
    }
    this.setSpeakerSprite(npcFile);

    // Ensure item/map names are loaded for #t and #m format codes
    await ensureItemNames();
    await ensureMapNames();

    // Build pages from dialogue text
    this.buildPages();

    // Preload item icons for reward display
    await this.preloadRewardIcons();

    this.recalcLayout();
    this.isHidden = false;
  }

  async showScriptDialog(opts: {
    npcId: number;
    npcName: string;
    questName: string;
    questId?: number;
    text: string;
    dialogType: ScriptDialogType;
    selections?: SelectionOption[];
    styles?: number[];
    input?: { def?: string | number; min?: number; max?: number };
    onInput?: (value: string) => void;
    onAction: (mode: number, type: number, selection: number) => void;
  }) {
    // sendStyle opens the avatar picker instead of this window
    if (opts.dialogType === 'style') {
      this.hide();
      await UIAvatarStyleDialog.show({
        npcId: opts.npcId,
        text: opts.text,
        styles: opts.styles || [],
        character: (window as any).charecter,
        onAction: opts.onAction,
      });
      return;
    }
    this.scriptMode = true;
    this.scriptDialogType = opts.dialogType;
    this.scriptOnAction = opts.onAction;
    this.scriptQuestName = opts.questName;
    if (opts.questId) this.questId = opts.questId;
    this.selections = opts.selections || [];
    this.accepted = false;
    this.selectedPropItem = null;
    this.destroyScriptInput();
    this.scriptInputOnInput = opts.onInput || null;
    this.scriptInputConfig = opts.input || null;

    // Load NPC sprite if different
    if (opts.npcId !== this.npcId || !this.speakerImg) {
      this.npcId = opts.npcId;
      this.npcName = opts.npcName;
      const strId = `${opts.npcId}`.padStart(7, '0');
      let npcFile: any = await WZManager.get(`Npc.wz/${strId}.img`);
      if (npcFile?.info?.link) {
        const linkId = npcFile.info.link.nValue;
        npcFile = await WZManager.get(`Npc.wz/${`${linkId}`.padStart(7, '0')}.img`);
      }
      this.setSpeakerSprite(npcFile);
    }

    // Preload item icons referenced in text via \x01ITEM:id\x02 markers
    const itemMatches = opts.text.matchAll(/\x01ITEM:(\d+)\x02/g);
    for (const m of itemMatches) {
      await this.loadItemIcon(parseInt(m[1]));
    }

    // Word-wrap the script text into pages
    const allLines = this.wrapText(opts.text, TEXT_MAX_W);
    this.pages = [];
    for (let i = 0; i < allLines.length; i += MAX_TEXT_LINES) {
      this.pages.push(allLines.slice(i, i + MAX_TEXT_LINES));
    }
    if (this.pages.length === 0) this.pages = [['']];
    this.currentPage = 0;

    this.recalcLayout();
    this.isHidden = false;
  }

  private buildPages() {
    const questDialogues = QuestData.dialogues.get(this.questId);
    const questInfo = QuestData.quests.get(this.questId);

    // Get all dialogue messages — sparse Say arrays may contain holes, and
    // selections/wrong answers key on the ORIGINAL message index
    let allMessages: string[] = [];
    let originalIndices: number[] | null = null;

    const compact = (src: string[]) => {
      const msgs: string[] = [];
      const idxs: number[] = [];
      src.forEach((m, i) => {
        if (m !== undefined) {
          msgs.push(m);
          idxs.push(i);
        }
      });
      originalIndices = idxs;
      return msgs;
    };

    if (this.phase === 'start') {
      if (questDialogues?.start?.messages?.length) {
        allMessages = compact(questDialogues.start.messages);
      } else if (questInfo?.startText) {
        allMessages = [questInfo.startText];
      } else {
        allMessages = ['Would you like to help me?'];
      }
    } else if (this.phase === 'complete') {
      if (questDialogues?.complete?.messages?.length) {
        allMessages = compact(questDialogues.complete.messages);
      } else if (questInfo?.completionText) {
        allMessages = [questInfo.completionText];
      } else {
        allMessages = ['Thank you for your help!'];
      }
    } else if (this.phase === 'inProgress') {
      const stopText = questDialogues?.start?.stop?.npc;
      if (stopText?.length) {
        allMessages = [...stopText];
      } else if (questInfo?.inProgressText) {
        allMessages = [questInfo.inProgressText];
      } else {
        allMessages = ['Please come back when you are done.'];
      }
    }

    // Resolve deferred #t and #c item codes now that item names are loaded
    const character = (window as any).charecter;
    this.sayMessages = allMessages.map(msg => resolveItemCodes(msg, character?.questManager, this.questId));
    this.preloadInlineIcons(this.sayMessages);
    this.sayOriginalIndices = originalIndices ?? allMessages.map((_, i) => i);
    this.messageIndex = 0;
    this.quizReply = null;
    this.selectionResolved = false;

    this.buildPagesForCurrentMessage();
  }

  /**
   * The original Say message index for the current position — needed to look
   * up selections/wrong answers because sparse Say arrays were compacted.
   */
  private getSayDialogue() {
    const questDialogues = QuestData.dialogues.get(this.questId);
    if (this.phase === 'start') return questDialogues?.start;
    if (this.phase === 'complete') return questDialogues?.complete;
    return undefined;
  }

  private getStaticSelections(): SelectionOption[] {
    if (this.scriptMode || this.accepted || this.quizReply !== null || this.selectionResolved) {
      return [];
    }
    const dlg = this.getSayDialogue();
    const origIdx = this.sayOriginalIndices[this.messageIndex] ?? this.messageIndex;
    const sels = dlg?.messageSelections?.get(origIdx);
    // Labels keep their #m/#t/#c codes from construction (names weren't
    // loaded yet) — resolve them here at display time like the messages
    const qm = (window as any).charecter?.questManager;
    return sels ? sels.map(s => ({ index: s.index, label: resolveItemCodes(s.label, qm, this.questId) })) : [];
  }

  private buildPagesForCurrentMessage() {
    const text = this.quizReply ?? this.sayMessages[this.messageIndex] ?? '';
    // Covers paths that set text without going through show()/accept (e.g. quiz replies)
    this.preloadInlineIcons([text]);
    const lines = this.wrapText(text, TEXT_MAX_W);

    this.pages = [];
    for (let i = 0; i < lines.length; i += MAX_TEXT_LINES) {
      this.pages.push(lines.slice(i, i + MAX_TEXT_LINES));
    }
    if (this.pages.length === 0) {
      this.pages = [['']];
    }
    this.currentPage = 0;

    this.selections = this.getStaticSelections();
    this.selectionRects = [];
  }

  private get isLastMessage(): boolean {
    return this.messageIndex >= this.sayMessages.length - 1;
  }

  /**
   * Whether the selection list is actually on screen.
   *
   * recalcLayout and draw MUST agree on this. They used to test different
   * conditions — layout reserved space whenever selections was non-empty,
   * while draw also required a 'simple' script dialog. After picking an
   * option from a sendSimple the dialog type becomes 'next', so the options
   * stopped rendering but still reserved their full height: Robin's 17-item
   * menu left 280px of blank space in every following dialog.
   */
  private get selectionsVisible(): boolean {
    return (
      this.selections.length > 0 &&
      ((this.scriptMode && this.scriptDialogType === 'simple') ||
        (!this.scriptMode && this.isLastPage))
    );
  }

  /**
   * Where the speaker's art sits inside its canvas, and how tall it really is.
   * Falls back to the declared WZ size while the sprite is still decoding —
   * that size is right for every NPC but the padded ones, and a re-layout
   * fires once the image lands.
   */
  /**
   * Ink bounds can only be read once the sprite has decoded. Usually it
   * already has — the NPC is standing on the map you clicked it from — but
   * when it hasn't, lay out again as soon as it lands rather than leaving the
   * frame sized to a canvas that is mostly empty.
   */
  /**
   * Pick the portrait for the dialog's left column.
   *
   * `stand/0` is the right answer for almost every NPC, but a handful are
   * painted into the map scenery and carry a transparent placeholder there
   * instead — Athena Pierce on the ark (1209007) has a 1x229 empty strip. Her
   * real portrait lives in `info/default`, which is what those NPCs use.
   * Taking the placeholder gave a blank portrait and, because the frame sizes
   * itself to the sprite, a dialog 229px taller than it needed to be.
   */
  private setSpeakerSprite(npcFile: any) {
    const stand = npcFile?.stand?.[0] || null;
    const fallback = npcFile?.info?.default || null;

    this.speakerNode = stand;
    this.speakerImg = stand?.nGetImage?.() || null;

    // Placeholders are markers, not art, and the WZ separates the two
    // cleanly: across all 6928 NPCs a `stand/0` is either 1px (5619 of them)
    // or 4px (56, e.g. Happyville's Santa 9209100, an invisible trigger with
    // hideName=1 whose portrait is the 179x80 info/default) in its smaller
    // dimension, and the smallest genuine sprite is 17. Anything in that gap
    // is a marker. The old test only looked at width and only caught <=2, so
    // the 4px markers slipped through and drew a blank portrait.
    const standSize = GUIUtil.wzSize(stand);
    const standIsPlaceholder =
      !stand || Math.min(standSize.width || 0, standSize.height || 0) <= 8;
    if (standIsPlaceholder && fallback) {
      this.speakerNode = fallback;
      this.speakerImg = fallback.nGetImage?.() || null;
    }
    this.relayoutWhenSpriteDecodes();
  }

  private relayoutWhenSpriteDecodes() {
    const img = this.speakerImg;
    if (!img || img.complete) return;
    img.addEventListener('load', () => {
      if (this.speakerImg === img && !this.isHidden) this.recalcLayout();
    }, { once: true });
  }

  private speakerMetrics(): { top: number; height: number } {
    const declared = GUIUtil.wzSize(this.speakerNode).height || this.speakerImg?.height || 0;
    return GUIUtil.verticalInkBounds(this.speakerImg) || { top: 0, height: declared };
  }

  private recalcLayout() {
    // fillCount based on NPC sprite height AND text height
    const currentLines = this.pages[this.currentPage] || [''];
    let textH = TEXT_TOP_OFFSET;
    for (const line of currentLines) {
      // Lines with inline item icons draw taller (icon ~32px vs LINE_H)
      textH += /\x01ITEM:\d+\x02/.test(line) ? 34 : LINE_H;
    }

    this.fillCount = 6;
    if (this.speakerImg) {
      const nameTagH = GUIUtil.wzSize(this.nameTagImg).height || 19;
      const spriteNeeded = this.speakerMetrics().height + nameTagH + 5;
      while (this.fillCount * FILL_H < spriteNeeded) {
        this.fillCount++;
      }
    }
    // Account for selection options height (including header images), but
    // only when they will actually be drawn — see selectionsVisible
    let headersH = 0;
    if (this.selectionsVisible) {
      for (const sel of this.selections) {
        if (sel.headerType) headersH += 22; // ~18px image + 4px gap
      }
    }
    const selectionsH = this.selectionsVisible
      ? this.selections.length * LINE_H + 8 + headersH
      : 0;
    // Account for rewards section height in static quest dialogs
    let rewardsH = 0;
    if (!this.scriptMode && this.questId && this.isLastPage && this.isLastMessage && this.quizReply === null && !this.accepted) {
      const rewards = QuestData.rewards.get(this.questId);
      const reward = this.phase === 'complete' ? (rewards?.complete || rewards?.start) : (rewards?.start || rewards?.complete);
      const displayItems = this.getDisplayRewardItems(reward || {});
      if (reward && (reward.exp || reward.meso || reward.fame || displayItems.length > 0)) {
        rewardsH += 30; // gap + REWARD icon
        if (reward.exp) rewardsH += LINE_H + 2;
        if (reward.meso) rewardsH += LINE_H + 2;
        if (reward.fame) rewardsH += LINE_H + 2;
        if (displayItems.length > 0) rewardsH += displayItems.length * 34; // ~32px icon height + 2px gap
      }
    }
    const totalTextH = textH + selectionsH + rewardsH;
    // Also ensure text fits
    while (this.fillCount * FILL_H < totalTextH) {
      this.fillCount++;
    }

    const totalH = TOP_H + FILL_H * this.fillCount + BOTTOM_H;
    this.x = Math.floor((config.width - DIALOG_WIDTH) / 2);
    this.y = Math.floor((config.height - totalH) / 2);

    this.createButtons();
  }

  private get isLastPage(): boolean {
    return this.currentPage >= this.pages.length - 1;
  }

  private createButtons() {
    this.buttons.forEach(btn => ClickManager.removeButton(btn));
    this.buttons = [];

    const bottomY = this.y + TOP_H + FILL_H * this.fillCount + 33;

    // Script mode — buttons based on scriptDialogType
    if (this.scriptMode) {
      this.createScriptButtons(bottomY);
      return;
    }

    if (this.accepted || this.phase === 'inProgress') {
      // Post-accept / in-progress pages navigate with Next/Prev; last page gets OK (GMS behavior)
      if (!this.isLastPage || !this.isLastMessage) {
        this.addButton(this.x + DIALOG_WIDTH - 60, bottomY,
          this.utilDlgExNode?.BtNext?.nChildren, () => {
            if (!this.isLastPage) {
              this.currentPage++;
            } else {
              this.messageIndex++;
              this.buildPagesForCurrentMessage();
            }
            this.recalcLayout();
          });
      } else {
        this.addButton(this.x + DIALOG_WIDTH - 60, bottomY,
          this.utilDlgExNode?.BtOK?.nChildren, () => this.hide());
      }
      if (this.currentPage > 0 || this.messageIndex > 0) {
        this.addButton(this.x + DIALOG_WIDTH - 120, bottomY,
          this.utilDlgExNode?.BtPrev?.nChildren, () => {
            if (this.currentPage > 0) {
              this.currentPage--;
            } else {
              this.messageIndex = Math.max(0, this.messageIndex - 1);
              this.buildPagesForCurrentMessage();
              this.currentPage = Math.max(0, this.pages.length - 1);
            }
            this.recalcLayout();
          });
      }
      this.addButton(this.x + 9, bottomY, this.utilDlgExNode?.BtClose?.nChildren, () => this.hide());
      return;
    }

    // Quiz wrong-answer reply: single OK returns to the question
    if (this.quizReply !== null) {
      this.addButton(this.x + DIALOG_WIDTH - 60, bottomY,
        this.utilDlgExNode?.BtOK?.nChildren, () => {
          this.quizReply = null;
          this.buildPagesForCurrentMessage();
          this.recalcLayout();
        });
      this.addButton(this.x + 9, bottomY,
        this.utilDlgExNode?.BtClose?.nChildren, () => this.hide());
      return;
    }

    // While selections are displayed on this message's last page, the
    // selection itself advances — no Next button
    const selectionsActive = this.selections.length > 0 && this.isLastPage;

    if (!this.isLastPage || !this.isLastMessage) {
      if (!selectionsActive) {
        this.addButton(this.x + DIALOG_WIDTH - 60, bottomY,
          this.utilDlgExNode?.BtNext?.nChildren, () => {
            if (!this.isLastPage) {
              this.currentPage++;
            } else {
              this.messageIndex++;
              this.buildPagesForCurrentMessage();
            }
            this.recalcLayout();
          });
      }
      if (this.currentPage > 0 || this.messageIndex > 0) {
        this.addButton(this.x + DIALOG_WIDTH - 120, bottomY,
          this.utilDlgExNode?.BtPrev?.nChildren, () => {
            if (this.currentPage > 0) {
              this.currentPage--;
            } else {
              this.messageIndex = Math.max(0, this.messageIndex - 1);
              this.buildPagesForCurrentMessage();
              this.currentPage = Math.max(0, this.pages.length - 1);
            }
            this.recalcLayout();
          });
      }
      // Close button for multi-message flows
      this.addButton(this.x + 9, bottomY,
        this.utilDlgExNode?.BtClose?.nChildren, () => this.hide());
    } else if (selectionsActive) {
      // Last message but a selection is pending — only close available
      this.addButton(this.x + 9, bottomY,
        this.utilDlgExNode?.BtClose?.nChildren, () => this.hide());
    } else {
      if (this.phase === 'start') {
        this.addButton(this.x + DIALOG_WIDTH - 120, bottomY,
          this.questNode?.BtOK?.nChildren, () => {
            if (this.onQuestAccepted) this.onQuestAccepted();
            this.accepted = true;
            this.selections = [];
            this.selectionRects = [];
            const questDialogues = QuestData.dialogues.get(this.questId);
            const qmRef = (window as any).charecter?.questManager;
            // Each Say.img yes entry is its own dialog page, navigated with Next/Prev (GMS behavior)
            if (questDialogues?.start?.yes?.length) {
              this.sayMessages = questDialogues.start.yes.map(t => resolveItemCodes(t, qmRef, this.questId));
            } else {
              const questInfo = QuestData.quests.get(this.questId);
              this.sayMessages = [resolveItemCodes(questInfo?.inProgressText || 'Quest accepted!', qmRef, this.questId)];
            }
            this.preloadInlineIcons(this.sayMessages);
            this.sayOriginalIndices = [];
            this.messageIndex = 0;
            this.buildPagesForCurrentMessage();
            this.recalcLayout();
          });
        this.addButton(this.x + DIALOG_WIDTH - 60, bottomY,
          this.questNode?.BtNo?.nChildren, () => {
            const questDialogues = QuestData.dialogues.get(this.questId);
            if (questDialogues?.start?.no?.length) {
              this.accepted = true;
              const qmRef = (window as any).charecter?.questManager;
              this.sayMessages = questDialogues.start.no.map(t => resolveItemCodes(t, qmRef, this.questId));
              this.preloadInlineIcons(this.sayMessages);
              this.sayOriginalIndices = [];
              this.messageIndex = 0;
              this.buildPagesForCurrentMessage();
              this.recalcLayout();
            } else {
              this.hide();
            }
          });
      } else if (this.phase === 'complete') {
        // GMS: last page shows rewards with OK button — click completes and closes
        this.addButton(this.x + DIALOG_WIDTH - 60, bottomY,
          this.utilDlgExNode?.BtOK?.nChildren, () => {
            if (this.onQuestCompleted) this.onQuestCompleted();
            this.hide();
          });
      }
    }
  }

  private createScriptButtons(bottomY: number) {
    const cb = this.scriptOnAction;
    if (!cb) return;

    const dt = this.scriptDialogType;

    // Use Quest-style buttons for script dialogs
    // "Accept" for accept/decline dialogs, "OK" (UtilDlgEx) for ok/next/prev
    const okBtn = this.utilDlgExNode?.BtOK?.nChildren;  // "OK" style
    const acceptBtn = this.questNode?.BtOK?.nChildren;   // "Accept" style
    const prevBtn = this.questNode?.BtNo?.nChildren;     // "Decline" style
    const nextBtn = okBtn; // Default single-button uses "OK"

    // Single-button dialogs (next, prev, ok) ALL send mode=1 when clicked.
    // The button label is cosmetic — the single action always advances the script.
    // Only multi-button dialogs (nextPrev, acceptDecline, yesNo) have a mode=0 button.
    switch (dt) {
      case 'next':
        this.addButton(this.x + DIALOG_WIDTH - 60, bottomY, nextBtn, () => cb(1, 0, -1));
        break;
      case 'prev':
        // Single button — advances script (mode=1), NOT go-back
        this.addButton(this.x + DIALOG_WIDTH - 60, bottomY, nextBtn, () => cb(1, 0, -1));
        break;
      case 'nextPrev':
        // Two buttons: Next (mode=1) + Prev (mode=0)
        this.addButton(this.x + DIALOG_WIDTH - 60, bottomY, nextBtn, () => cb(1, 0, -1));
        this.addButton(this.x + DIALOG_WIDTH - 120, bottomY, prevBtn, () => cb(0, 0, -1));
        break;
      case 'ok':
        this.addButton(this.x + DIALOG_WIDTH - 60, bottomY, nextBtn, () => cb(1, 0, -1));
        break;
      case 'acceptDecline':
        // Two buttons: Accept (mode=1, type=1) + Decline (mode=0, type=1)
        this.addButton(this.x + DIALOG_WIDTH - 60, bottomY, acceptBtn, () => cb(1, 1, -1));
        this.addButton(this.x + DIALOG_WIDTH - 120, bottomY, prevBtn, () => cb(0, 1, -1));
        break;
      case 'yesNo':
        this.addButton(this.x + DIALOG_WIDTH - 60, bottomY, acceptBtn, () => cb(1, 1, -1));
        this.addButton(this.x + DIALOG_WIDTH - 120, bottomY, prevBtn, () => cb(0, 1, -1));
        break;
      case 'simple':
        // Selection options are rendered as clickable text in draw(), not as WZ buttons
        // No next/prev buttons for simple selection dialogs
        break;
      case 'getText':
      case 'getNumber': {
        // DOM input field inside the frame; OK submits the value to the engine
        this.destroyScriptInput();
        if (this.measureCanvas) {
          const inputY = bottomY - 30;
          this.scriptInput = new MapleInput(this.measureCanvas, {
            x: this.x + TEXT_LEFT,
            y: inputY,
            width: 200,
            height: 16,
            color: '#000000',
            background: '#ffffff',
            border: '1px solid #999999',
            type: dt === 'getNumber' ? 'number' : 'text',
          });
          const def = this.scriptInputConfig?.def;
          if (def !== undefined && def !== null && def !== '') {
            this.scriptInput.input.value = String(def);
          }
          this.scriptInput.input.focus();
        }
        this.addButton(this.x + DIALOG_WIDTH - 60, bottomY, okBtn, () => {
          let value = this.scriptInput?.input?.value ?? '';
          if (dt === 'getNumber') {
            let num = parseInt(value) || 0;
            const cfg = this.scriptInputConfig;
            if (cfg?.min !== undefined) num = Math.max(cfg.min, num);
            if (cfg?.max !== undefined) num = Math.min(cfg.max, num);
            value = String(num);
          }
          this.scriptInputOnInput?.(value);
          this.destroyScriptInput();
          cb(1, 1, -1);
        });
        break;
      }
    }

    // Always add close/ESC button
    this.addButton(this.x + 9, bottomY,
      this.utilDlgExNode?.BtClose?.nChildren, () => cb(-1, 0, -1));
  }

  private addButton(x: number, y: number, img: any, onClick: () => void) {
    const btn = new MapleStanceButton(null, {
      x, y,
      img: img || this.utilDlgExNode?.BtClose?.nChildren,
      isRelativeToCamera: true,
      isPartOfUI: true,
      onClick,
    });
    this.buttons.push(btn);
    ClickManager.addButton(btn);
  }

  private destroyScriptInput() {
    if (this.scriptInput) {
      this.scriptInput.remove();
      this.scriptInput = null;
    }
  }

  hide() {
    this.buttons.forEach(btn => ClickManager.removeButton(btn));
    this.buttons = [];
    this.isHidden = true;
    if (UIAvatarStyleDialog.isVisible) UIAvatarStyleDialog.hide();
    this.onQuestAccepted = null;
    this.onQuestCompleted = null;
    this.scriptMode = false;
    this.scriptOnAction = null;
    this.selections = [];
    this.selectionRects = [];
    this.hoveredSelection = -1;
    this.destroyScriptInput();
    this.scriptInputOnInput = null;
    this.scriptInputConfig = null;
  }

  // Handle click on selection options — returns true if a selection was clicked
  handleClick(canvasX: number, canvasY: number): boolean {
    if (this.isHidden) return false;
    if (this.selectionRects.length === 0) {
      console.log(`[QuestDialog] handleClick: no selectionRects, selections=${this.selections.length}, scriptMode=${this.scriptMode}, type=${this.scriptDialogType}`);
      return false;
    }
    console.log(`[QuestDialog] handleClick at (${canvasX}, ${canvasY}), ${this.selectionRects.length} rects:`, this.selectionRects.map(r => `idx=${r.index} (${r.x},${r.y},${r.w},${r.h})`));
    for (const rect of this.selectionRects) {
      if (canvasX >= rect.x && canvasX <= rect.x + rect.w &&
          canvasY >= rect.y && canvasY <= rect.y + rect.h) {
        if (this.scriptMode) {
          this.scriptOnAction?.(1, 4, rect.index);
        } else {
          this.handleStaticSelection(rect.index);
        }
        return true;
      }
    }
    return false;
  }

  /**
   * WZ Say-driven selection click: wrong quiz answers show their reply and
   * return to the question; correct/plain options advance the dialogue.
   */
  private handleStaticSelection(selIndex: number) {
    const dlg = this.getSayDialogue();
    const origIdx = this.sayOriginalIndices[this.messageIndex] ?? this.messageIndex;
    const wrong = dlg?.wrongAnswers?.get(origIdx)?.get(selIndex);

    if (wrong !== undefined) {
      const qmRef = (window as any).charecter?.questManager;
      this.quizReply = resolveItemCodes(wrong, qmRef, this.questId);
      this.buildPagesForCurrentMessage();
      this.recalcLayout();
      return;
    }

    if (!this.isLastMessage) {
      this.messageIndex++;
      this.buildPagesForCurrentMessage();
      this.recalcLayout();
    } else {
      // Last message answered correctly — reveal the accept/decline step
      this.selectionResolved = true;
      this.selections = [];
      this.selectionRects = [];
      this.recalcLayout();
    }
  }

  // Update hover state for selection options
  handleMouseMove(canvasX: number, canvasY: number) {
    if (this.isHidden || this.selectionRects.length === 0) {
      this.hoveredSelection = -1;
      return;
    }
    this.hoveredSelection = -1;
    for (const rect of this.selectionRects) {
      if (canvasX >= rect.x && canvasX <= rect.x + rect.w &&
          canvasY >= rect.y && canvasY <= rect.y + rect.h) {
        this.hoveredSelection = rect.index;
        break;
      }
    }
  }

  draw(canvas: GameCanvas, camera: CameraInterface, lag: number, msPerTick: number, tdelta: number) {
    if (this.isHidden) return;

    // Store canvas ref for text measurement
    if (!this.measureCanvas) this.measureCanvas = canvas;

    const totalH = TOP_H + this.fillCount * FILL_H + BOTTOM_H;
    UIDevTools.track('questDialog', this.x, this.y, DIALOG_WIDTH, totalH, 'screen', 'UI.wz/UIWindow.img/UtilDlgEx');

    let y = this.y;

    // Draw UtilDlgEx frame
    canvas.drawImage({ img: this.topImg?.nGetImage(), dx: this.x, dy: y });
    y += TOP_H;

    for (let i = 0; i < this.fillCount; i++) {
      canvas.drawImage({ img: this.fillImg?.nGetImage(), dx: this.x, dy: y });
      y += FILL_H;
    }

    canvas.drawImage({ img: this.bottomImg?.nGetImage(), dx: this.x, dy: y });

    // Draw NPC sprite + name tag
    if (this.speakerImg) {
      const nameTagImgEl = this.nameTagImg?.nGetImage();
      const tagW = GUIUtil.wzSize(this.nameTagImg).width || 121;
      const tagH = GUIUtil.wzSize(this.nameTagImg).height || 19;
      const spriteW = GUIUtil.wzSize(this.speakerNode).width || this.speakerImg.width;
      // Height of the art itself, and how far down its canvas it starts —
      // the whole canvas still gets drawn, just shifted so the visible part
      // lands where the layout reserved room for it
      const { top: spriteInkTop, height: spriteH } = this.speakerMetrics();

      // Portrait and name tag are one group, centred vertically in the
      // dialog body — not pinned to the top. A dialog grown tall by a long
      // message or a selection list otherwise left them stranded up in the
      // corner with the whole left column empty beneath them.
      const bodyH = FILL_H * this.fillCount;
      const groupH = spriteH + NAME_TAG_GAP + tagH;
      const groupY = this.y + TOP_H + Math.max(0, Math.floor((bodyH - groupH) / 2));

      const spriteX = this.x + LEFT_PADDING + Math.floor(tagW / 2) - Math.floor(spriteW / 2);
      canvas.drawImage({ img: this.speakerImg, dx: spriteX, dy: groupY - spriteInkTop });

      const tagY = groupY + spriteH + NAME_TAG_GAP;
      if (nameTagImgEl) {
        canvas.drawImage({
          img: nameTagImgEl,
          dx: this.x + LEFT_PADDING,
          dy: tagY,
        });
        canvas.drawText({
          text: this.npcName,
          color: '#FFFFFF',
          x: this.x + LEFT_PADDING + Math.floor(tagW / 2),
          y: tagY + 5,
          align: 'center',
        });
      }
    }

    // Quest name header
    const questName = this.scriptMode ? this.scriptQuestName : QuestData.quests.get(this.questId)?.name;
    if (questName) {
      canvas.drawText({
        text: questName,
        color: '#0066CC',
        x: this.x + TEXT_LEFT,
        y: this.y + 32,
        fontSize: 13,
        fontWeight: 'bold',
      });
    }

    // Draw current page text (with inline image support for #v and #f codes)
    const lines = this.pages[this.currentPage] || [];
    let textY = this.y + TEXT_TOP_OFFSET;
    for (const line of lines) {
      // Parse inline image markers: \x01ITEM:id\x02 and \x01QICON:id\x02
      const parts = line.split(/(\x01(?:ITEM|QICON):\d+\x02)/);
      let lineX = this.x + TEXT_LEFT;
      let lineH = LINE_H;
      for (const part of parts) {
        const itemMatch = part.match(/\x01ITEM:(\d+)\x02/);
        const qiconMatch = part.match(/\x01QICON:(\d+)\x02/);
        if (itemMatch) {
          const itemId = parseInt(itemMatch[1]);
          const icon = this.itemIconCache.get(itemId);
          if (icon) {
            canvas.drawImage({ img: icon, dx: lineX, dy: textY - 2 });
            lineX += (icon.width || 32) + 2;
            lineH = Math.max(lineH, (icon.height || 32) + 2);
          }
        } else if (qiconMatch) {
          const qiconId = qiconMatch[1];
          const icon = this.questIconCache?.get(qiconId);
          if (icon) {
            canvas.drawImage({ img: icon, dx: lineX, dy: textY - 2 });
            lineX += (icon.width || 40) + 2;
            lineH = Math.max(lineH, (icon.height || 17) + 2);
          }
        } else if (part) {
          canvas.drawText({
            text: part,
            color: '#000000',
            x: lineX,
            y: textY,
            fontSize: 12,
          });
          lineX += part.length * 7; // approximate width
        }
      }
      textY += lineH;
    }

    // Draw quest rewards section (on last page of static quest dialogs only — scripts handle their own)
    if (!this.scriptMode && this.questId && this.isLastPage && this.isLastMessage && this.quizReply === null && !this.accepted) {
      const rewards = QuestData.rewards.get(this.questId);
      // Show complete rewards if phase is complete, otherwise start rewards; fall back to whichever has data
      const reward = this.phase === 'complete' ? (rewards?.complete || rewards?.start) : (rewards?.start || rewards?.complete);
      const displayItems = this.getDisplayRewardItems(reward || {});
      const hasRewards = reward && (reward.exp || reward.meso || reward.fame || displayItems.length > 0);
      if (hasRewards) {
        textY += 8;
        // Draw REWARD!! icon
        if (this.rewardIcon) {
          canvas.drawImage({ img: this.rewardIcon, dx: this.x + TEXT_LEFT, dy: textY });
          textY += (this.rewardIcon.height || 16) + 6;
        } else {
          canvas.drawText({
            text: 'REWARD!!',
            color: '#CC4400',
            x: this.x + TEXT_LEFT,
            y: textY,
            fontSize: 12,
            fontWeight: 'bold',
          });
          textY += LINE_H + 4;
        }
        // Draw EXP reward
        if (reward.exp) {
          const iconX = this.x + TEXT_LEFT;
          if (this.expIcon) {
            canvas.drawImage({ img: this.expIcon, dx: iconX, dy: textY });
          }
          canvas.drawText({
            text: `${reward.exp} exp`,
            color: '#000000',
            x: iconX + (this.expIcon?.width || 43) + 6,
            y: textY + 1,
            fontSize: 12,
          });
          textY += LINE_H + 2;
        }
        // Draw meso reward
        if (reward.meso) {
          const iconX = this.x + TEXT_LEFT;
          if (this.mesoIcon) {
            canvas.drawImage({ img: this.mesoIcon, dx: iconX, dy: textY });
          }
          canvas.drawText({
            text: `${reward.meso} meso`,
            color: '#000000',
            x: iconX + (this.mesoIcon?.width || 49) + 6,
            y: textY + 1,
            fontSize: 12,
          });
          textY += LINE_H + 2;
        }
        // Draw fame reward
        if (reward.fame) {
          const iconX = this.x + TEXT_LEFT;
          if (this.fameIcon) {
            canvas.drawImage({ img: this.fameIcon, dx: iconX, dy: textY });
          }
          canvas.drawText({
            text: `${reward.fame} fame`,
            color: '#000000',
            x: iconX + (this.fameIcon?.width || 48) + 6,
            y: textY + 1,
            fontSize: 12,
          });
          textY += LINE_H + 2;
        }
        // Draw item rewards with icons (only display items — prop items reduced to one random pick)
        if (displayItems.length > 0) {
          for (const item of displayItems) {
            const iconX = this.x + TEXT_LEFT;
            const itemIcon = this.itemIconCache.get(item.id);
            if (itemIcon) {
              canvas.drawImage({ img: itemIcon, dx: iconX, dy: textY });
              canvas.drawText({
                text: `x${item.count}`,
                color: '#000000',
                x: iconX + (itemIcon.width || 32) + 4,
                y: textY + 10,
                fontSize: 12,
              });
              textY += Math.max(itemIcon.height || 32, LINE_H) + 2;
            } else {
              canvas.drawText({
                text: `${item.count} x item #${item.id}`,
                color: '#000000',
                x: iconX + 4,
                y: textY + 1,
                fontSize: 12,
              });
              textY += LINE_H + 2;
            }
          }
        }
      }
    }

    // Draw selection options — script 'simple' dialogs and WZ Say #L selections
    if (this.selectionsVisible) {
      textY += 4; // small gap before selections
      this.selectionRects = [];
      for (const sel of this.selections) {
        // Draw quest category header image if present
        let headerImg: HTMLImageElement | null = null;
        if (sel.headerType === 'completable') headerImg = this.listCompletableImg;
        else if (sel.headerType === 'inProgress') headerImg = this.listInProgressImg;
        else if (sel.headerType === 'available') headerImg = this.listAvailableImg;

        if (headerImg) {
          canvas.drawImage({ img: headerImg, dx: this.x + TEXT_LEFT, dy: textY });
          textY += (headerImg.height || 18) + 4;
        }

        const selX = this.x + TEXT_LEFT;
        const isHovered = this.hoveredSelection === sel.index;

        // Draw "ETC" header for NPC script conversation options
        if (sel.headerType === 'etc' && this.listEtcImg) {
          canvas.drawImage({ img: this.listEtcImg, dx: selX, dy: textY });
          textY += (this.listEtcImg.height || 12) + 4;
        }

        // Simple dot bullet before each selection
        canvas.drawText({
          text: `\u2022 ${sel.label}`,
          color: isHovered ? '#0055CC' : '#0066FF',
          x: selX + 4,
          y: textY,
          fontSize: 12,
        });
        this.selectionRects.push({
          index: sel.index,
          x: selX,
          y: textY - 2,
          w: TEXT_MAX_W,
          h: LINE_H,
        });
        textY += LINE_H;
      }
    }

    // Draw buttons
    this.buttons.forEach(btn => btn.draw(canvas, camera, lag, msPerTick, tdelta));
  }

  private wrapText(text: string, maxWidth: number): string[] {
    const lines: string[] = [];
    if (!text) return [''];

    const paragraphs = text.split('\n');
    for (const para of paragraphs) {
      if (!para.trim()) { lines.push(''); continue; }
      const words = para.split(' ');
      let current = '';
      for (const word of words) {
        const test = current ? `${current} ${word}` : word;
        // Estimate width: ~7px per character at fontSize 12
        const estWidth = test.length * 7;
        if (estWidth > maxWidth && current) {
          lines.push(current);
          current = word;
        } else {
          current = test;
        }
      }
      if (current) lines.push(current);
    }
    return lines.length > 0 ? lines : [''];
  }
}
