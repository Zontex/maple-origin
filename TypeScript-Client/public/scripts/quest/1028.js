/* Quest 1028 - To Lith Harbor!
   NPC: Shanks (22000) at Southperry
   This startscript just force-starts the quest so the NPC script (22000.js) can handle the trip.
*/
var status = -1;

function start(mode, type, selection) {
    if (mode == -1) {
        qm.dispose();
        return;
    }
    status++;

    if (status == 0) {
        qm.sendNext("Now that you have the recommendation letter from #p12000#, you should head to Victoria Island! Talk to #p22000# at the dock in #m60000# to catch a ride.");
    } else if (status == 1) {
        qm.forceStartQuest();
        qm.dispose();
    }
}

function end(mode, type, selection) {
    qm.dispose();
}
