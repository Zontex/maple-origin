/* NPC 1090000 - Kyrin
   Pirate Job Instructor — Nautilus Harbor
   First job advancement: Beginner -> Pirate at level 10+
   Requires: DEX 20+
*/
var status = 0;

function start() {
    if (cm.getJobId() == 0 && cm.getLevel() >= 10) {
        cm.sendNext("Ahoy! I'm #bKyrin#k, captain of the Nautilus. I hear you want to become a #bPirate#k?");
    } else if (cm.getJobId() == 0 && cm.getLevel() < 10) {
        cm.sendOk("You want to become a Pirate? Ha! You're still too green. Come back at #bLevel 10#k and we'll talk.");
        cm.dispose();
    } else {
        cm.sendOk("Keep fighting hard out there, Pirate! The sea is vast and full of adventure.");
        cm.dispose();
    }
}

function action(mode, type, selection) {
    if (mode == -1 || mode == 0) {
        cm.sendOk("The sea isn't going anywhere. Come back when you've made up your mind!");
        cm.dispose();
        return;
    }
    status++;

    if (status == 1) {
        if (cm.getPlayer().getDex() >= 20) {
            cm.sendYesNo("Your #bDEX#k is solid. You've got the reflexes of a natural sailor. Are you ready to become a #bPirate#k?");
        } else {
            cm.sendOk("You need better reflexes to be a Pirate. Train your #bDEX#k to at least #b20#k, then come find me again.");
            cm.dispose();
        }
    } else if (status == 2) {
        cm.changeJobById(500);
        cm.sendOk("You are now a #bPirate#k! Whether you fight with your fists or a gun, the world is yours to explore. Welcome aboard!");
        cm.dispose();
    }
}
