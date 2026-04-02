/* NPC 1052001 - Dark Lord
   Thief Job Instructor — Kerning City
   First job advancement: Beginner -> Thief at level 10+
   Requires: DEX 25+
*/
var status = 0;

function start() {
    if (cm.getJobId() == 0 && cm.getLevel() >= 10) {
        cm.sendNext("I am the #bDark Lord#k, master of the shadows. You seek to walk the path of the Thief?");
    } else if (cm.getJobId() == 0 && cm.getLevel() < 10) {
        cm.sendOk("You're too inexperienced to join us. Reach #bLevel 10#k first, then we can talk.");
        cm.dispose();
    } else {
        cm.sendOk("Stay sharp. The shadows are your ally.");
        cm.dispose();
    }
}

function action(mode, type, selection) {
    if (mode == -1 || mode == 0) {
        cm.sendOk("The shadows will always be here. Return when you are ready.");
        cm.dispose();
        return;
    }
    status++;

    if (status == 1) {
        if (cm.getPlayer().getDex() >= 25) {
            cm.sendYesNo("Your #bDEX#k shows promise. You're quick and agile — perfect qualities for a Thief. Do you want to become a #bThief#k?");
        } else {
            cm.sendOk("You're not nimble enough yet. A Thief requires at least #b25 DEX#k. Train harder and return to me.");
            cm.dispose();
        }
    } else if (status == 2) {
        cm.changeJobById(400);
        cm.sendOk("You are now a #bThief#k! Strike from the shadows and vanish before your enemies can react. Use your skills wisely.");
        cm.dispose();
    }
}
