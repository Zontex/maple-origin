/* NPC 1012100 - Athena Pierce
   Bowman Job Instructor — Henesys
   First job advancement: Beginner -> Bowman at level 10+
   Requires: DEX 25+
*/
var status = 0;

function start() {
    if (cm.getJobId() == 0 && cm.getLevel() >= 10) {
        cm.sendNext("I am #bAthena Pierce#k, instructor of the Bowmen. You wish to learn the way of the bow and arrow?");
    } else if (cm.getJobId() == 0 && cm.getLevel() < 10) {
        cm.sendOk("You want to become a #bBowman#k? You're not ready yet. Come back when you've reached #bLevel 10#k.");
        cm.dispose();
    } else {
        cm.sendOk("Welcome back. Keep honing your skills, Bowman.");
        cm.dispose();
    }
}

function action(mode, type, selection) {
    if (mode == -1 || mode == 0) {
        cm.sendOk("The forest will wait for you. Come back when you're ready.");
        cm.dispose();
        return;
    }
    status++;

    if (status == 1) {
        if (cm.getPlayer().getDex() >= 25) {
            cm.sendYesNo("Your #bDEX#k is remarkable. You have the sharp eye and steady hand of a natural archer. Will you become a #bBowman#k?");
        } else {
            cm.sendOk("You need to be more agile to handle a bow. Train your #bDEX#k to at least #b25#k, then come back to me.");
            cm.dispose();
        }
    } else if (status == 2) {
        cm.changeJobById(300);
        cm.sendOk("You are now a #bBowman#k! Take this bow and let your arrows fly true. A Bowman's greatest strength is distance and precision.");
        cm.dispose();
    }
}
