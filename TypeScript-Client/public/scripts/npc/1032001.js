/* NPC 1032001 - Grendel the Really Old
   Magician Job Instructor — Ellinia
   First job advancement: Beginner -> Magician at level 8+
   Requires: INT 20+
*/
var status = 0;

function start() {
    if (cm.getJobId() == 0 && cm.getLevel() >= 8) {
        cm.sendNext("Oh, a young one seeking the path of magic? You have come to the right place. I am #bGrendel the Really Old#k, and I have been teaching magic for centuries.");
    } else if (cm.getJobId() == 0 && cm.getLevel() < 8) {
        cm.sendOk("You wish to learn magic? You must first reach #bLevel 8#k before I can teach you. Go out and gain more experience.");
        cm.dispose();
    } else {
        cm.sendOk("Keep studying hard. The mysteries of magic are endless.");
        cm.dispose();
    }
}

function action(mode, type, selection) {
    if (mode == -1 || mode == 0) {
        cm.sendOk("The path of magic will always be open to you. Return when you are ready.");
        cm.dispose();
        return;
    }
    status++;

    if (status == 1) {
        if (cm.getPlayer().getInt() >= 20) {
            cm.sendYesNo("I can feel the magical energy within you. Your #bINT#k is sufficient to begin studying magic. Do you wish to become a #bMagician#k?");
        } else {
            cm.sendOk("I sense your desire to learn magic, but your #bINT#k is not yet high enough. You need at least #b20 INT#k to begin studying magic.");
            cm.dispose();
        }
    } else if (status == 2) {
        cm.changeJobById(200);
        cm.sendOk("You are now a #bMagician#k! I have bestowed upon you the power of magic. Study hard and grow stronger. The world needs powerful mages.");
        cm.dispose();
    }
}
