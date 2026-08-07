// MyCharacterSetup.ts
import MapleCharacter from "./MapleCharacter";
import Stats from "./Stats/Stats";
import { JobId } from "./Constants/Jobs";
import Inventory from "./Inventory/Inventory";
import QuestManager from "./Quest/QuestManager";
import SkillManager from "./Skills/SkillManager";
import BuffManager from "./Skills/BuffManager";

const MyCharacter = new MapleCharacter({
  name: "Player",
  hp: 50,          // v83 Beginner starts with 50 HP
  maxHp: 50,       // maximum health at level 1
  mp: 5,           // v83 Beginner starts with 5 MP
  maxMp: 5,        // maximum magic points at level 1
  Hair: 30030,     // initial hair id (example value)
  exp: 0,          // starting experience
  fame: 0,         // starting fame
  inventory: new Inventory({
    mesos: 0,
  }),
  stats: new Stats({
    str: 4,
    dex: 4,
    int: 4,
    luk: 4,
    abilityPoints: 0,
    maxHp: 50,
    maxMp: 5,
    jobId: JobId.Beginner,          // v83 numeric job ID (0 = Beginner)
    level: 1,
  }),
});

// Initialize equipment array.
MyCharacter.equips = [];

// Initialize quest manager.
MyCharacter.questManager = new QuestManager(MyCharacter);
MyCharacter.questManager.initialize();

// Initialize skill manager.
MyCharacter.skillManager = new SkillManager(MyCharacter);
MyCharacter.skillManager.initialize();

// Initialize buff manager — buff apply/expire recalculates effective stats.
(MyCharacter as any).buffManager = new BuffManager(() => MyCharacter.recalcLocalStats());
MyCharacter.recalcLocalStats();

declare global {
  interface Window {
    charecter: MapleCharacter;
  }
}

window.charecter = MyCharacter;

/**
 * Revive a character that was saved mid-death (game closed before clicking OK
 * on the death dialog, so the disconnect auto-save wrote hp=0). Matches
 * Cosmic's loadCharFromDB guard: revive with 50 HP at the death map's
 * returnMap. Mutates charData in place — call before applying hp/map/pos.
 */
export async function reviveOfflineDeath(charData: any): Promise<void> {
  if (typeof charData?.hp !== "number" || charData.hp > 0) return;

  charData.hp = Math.min(50, charData.maxHp || 50);
  try {
    const WZManager = (await import("./wz-utils/WZManager")).default;
    const prefix = Math.floor(charData.mapId / 100000000);
    const strId = `${charData.mapId}`.padStart(9, "0");
    const mapNode: any = await WZManager.get(`Map.wz/Map/Map${prefix}/${strId}.img`);
    const returnMap = Number(mapNode?.info?.returnMap?.nValue);
    // 999999999 = "no return map" sentinel in the WZ data
    if (
      Number.isFinite(returnMap) &&
      returnMap > 0 &&
      returnMap !== 999999999 &&
      returnMap !== Number(charData.mapId)
    ) {
      charData.mapId = returnMap;
      // 0/0 = "no saved position" — both login paths then spawn at a portal
      charData.posX = 0;
      charData.posY = 0;
    }
  } catch (e) {
    console.warn("[Revive] Could not resolve returnMap for map", charData.mapId, e);
  }
  console.log(`[Revive] Character loaded dead — revived with ${charData.hp} HP at map ${charData.mapId}`);
}

export default MyCharacter;
