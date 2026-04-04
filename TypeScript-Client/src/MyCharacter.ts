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
    mesos: 20000,    // starting mesos
  }),
  stats: new Stats({
    str: 12,
    dex: 5,
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

// Initialize buff manager.
(MyCharacter as any).buffManager = new BuffManager();

declare global {
  interface Window {
    charecter: MapleCharacter;
  }
}

window.charecter = MyCharacter;

export default MyCharacter;
