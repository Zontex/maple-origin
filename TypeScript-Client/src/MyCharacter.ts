// MyCharacterSetup.ts
import MapleCharacter from "./MapleCharacter";
import Stats from "./Stats/Stats";
import { JobId } from "./Constants/Jobs";
import MapleMap from "./MapleMap";
import Inventory from "./Inventory/Inventory";
import Item from "./Inventory/Item";
import QuestManager from "./Quest/QuestManager";

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

declare global {
  interface Window {
    charecter: MapleCharacter;
  }
}

window.charecter = MyCharacter;

// Attach beginner equipment
window.charecter.attachEquip(4, 1040002);   // Coat (white undershirt)
window.charecter.attachEquip(5, 1060002);   // Pants (blue)
window.charecter.attachEquip(10, 1302000);  // Weapon (sword)

// Example of adding an item to the equipment inventory.
const addInventory = async () => {
  try {
    MyCharacter.inventory.use = [
      await Item.fromOpts({ itemId: 2000000, quantity: 5 }), // red potion
      await Item.fromOpts({ itemId: 2000001, quantity: 3 }), // orange potion
      await Item.fromOpts({ itemId: 2000002, quantity: 10 }), // white potion
    ];
    MyCharacter.inventory.etc = [];
  } catch (e) {
    console.error('Error loading test inventory items:', e);
  }
};

addInventory();

export default MyCharacter;
