/* NPC 1022000 - Dances with Balrog
   Warrior Job Instructor — Perion
   First job advancement: Beginner -> Warrior at level 10+
   Requires: STR 35+
*/
var status = 0;

function start() {
    if (cm.getJobId() == 0 && cm.getLevel() >= 10) {
        cm.sendNext("So you want to become a #bWarrior#k? You need to be strong in body and mind. Let me see if you have what it takes...");
    } else if (cm.getJobId() == 0 && cm.getLevel() < 10) {
        cm.sendOk("You want to become a #bWarrior#k? You're still too weak for that. Come back when you've reached #bLevel 10#k.");
        cm.dispose();
    } else {
        cm.sendOk("Keep training hard, warrior. You'll become even stronger.");
        cm.dispose();
    }
}

function action(mode, type, selection) {
    if (mode == -1 || mode == 0) {
        cm.sendOk("Take your time. Come back when you're ready to become a Warrior.");
        cm.dispose();
        return;
    }
    status++;

    if (status == 1) {
        if (cm.getPlayer().getStr() >= 35) {
            cm.sendYesNo("You seem strong enough. Your #bSTR#k is impressive. Are you sure you want to become a #bWarrior#k? This decision is irreversible.");
        } else {
            cm.sendOk("Hmm... I'm afraid you're not strong enough yet. A Warrior needs at least #b35 STR#k. Come back when you've built up your strength.");
            cm.dispose();
        }
    } else if (status == 2) {
        cm.changeJobById(100);
        cm.sendOk("You are now a #bWarrior#k! From here on, you will become a powerful fighter. I have given you some #bSP#k and increased your inventory. Use them wisely.");
        cm.dispose();
    }
}
