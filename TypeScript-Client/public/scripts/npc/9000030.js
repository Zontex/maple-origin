/*
 * Maple Admin the Witness — Free Market entrance.
 *
 * Dresses the player in a complete Maple avatar for a chosen job: hair, face
 * and the whole Maple gear set for that class. Everything used here exists in
 * v83's own WZ data — the Maple set has a weapon for every class plus the
 * three class shields, so each job gets a real loadout rather than a reskin.
 *
 * Not a Cosmic script: this NPC is specific to this project (see
 * public/data/custom-npcs.json), so the file is authored rather than ported.
 */
var status = -1;

// Every avatar shares the Maple hat and cape; the weapon, shield, hair and
// face are what make each job's look its own.
var HAT = 1002510;   // Maple Hat
var CAPE = 1102166;  // Maple Cape

var AVATARS = [
  { name: "Warrior",  hair: 30030, face: 20001, gear: [1302020, 1092046] },            // Maple Sword + Warrior shield
  { name: "Magician", hair: 30020, face: 20002, gear: [1382039, 1092045] },            // Maple Wisdom Staff + Magician shield
  { name: "Bowman",   hair: 31040, face: 21000, gear: [1452045] },                     // Maple Kandiva Bow
  { name: "Thief",    hair: 30040, face: 20000, gear: [1472055, 1092047] },            // Maple Skanda + Thief shield
  { name: "Pirate",   hair: 31050, face: 21002, gear: [1492022] },                     // Maple Canon Shooter
  { name: "Beginner", hair: 30000, face: 20000, gear: [1302058] }                      // Maple Umbrella
];

function start() {
  status = -1;
  action(1, 0, 0);
}

function action(mode, type, selection) {
  // Any single-button dialog sends mode=1; the close box sends -1.
  if (mode === -1) {
    cm.dispose();
    return;
  }
  if (mode === 0) {
    cm.dispose();
    return;
  }

  status++;

  if (status === 0) {
    cm.sendNext(
      "So you want the #bMaple look#k? I keep a set for every class back here " +
      "— hair, face and the full Maple gear. Say the word and I'll have " +
      "you kitted out on the spot."
    );
    return;
  }

  if (status === 1) {
    var text = "Which one shall it be?#b";
    for (var i = 0; i < AVATARS.length; i++) {
      text += "\r\n#L" + i + "#" + AVATARS[i].name + " Avatar#l";
    }
    cm.sendSimple(text);
    return;
  }

  if (status === 2) {
    var pick = AVATARS[selection];
    if (!pick) {
      cm.dispose();
      return;
    }
    cm.setHair(pick.hair);
    cm.setFace(pick.face);
    cm.equipItem(HAT);
    cm.equipItem(CAPE);
    for (var g = 0; g < pick.gear.length; g++) {
      cm.equipItem(pick.gear[g]);
    }
    cm.sendOk("There you go — one #b" + pick.name + " Avatar#k. Wear it well.");
    return;
  }

  cm.dispose();
}
