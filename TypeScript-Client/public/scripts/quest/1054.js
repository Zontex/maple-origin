/* Quest 1054 - Cygnus Knights
   NPC: Neinheart (1101002) at Ereve
   Auto-starts at level 20 for Noblesse characters.
   Introduces the Cygnus Knights path.
*/
var status = -1;

function start(mode, type, selection) {
    if (mode == -1) {
        qm.dispose();
        return;
    }
    status++;

    if (status == 0) {
        qm.sendNext("Welcome, young knight. The Empress Cygnus has been waiting for someone with your potential. The Cygnus Knights are an elite order dedicated to protecting Maple World from the Black Mage's forces.");
    } else if (status == 1) {
        qm.sendSimple("Which order of the Cygnus Knights would you like to join?\r\n#L1100#I want to join the #bDawn Warriors#k (Warrior)#l\r\n#L1200#I want to join the #bBlaze Wizards#k (Magician)#l\r\n#L1300#I want to join the #bWind Archers#k (Bowman)#l\r\n#L1400#I want to join the #bNight Walkers#k (Thief)#l\r\n#L1500#I want to join the #bThunder Breakers#k (Pirate)#l");
    } else if (status == 2) {
        var jobId = 0;
        var jobName = "";

        if (selection == 1100) {
            jobId = 1100; jobName = "Dawn Warrior";
        } else if (selection == 1200) {
            jobId = 1200; jobName = "Blaze Wizard";
        } else if (selection == 1300) {
            jobId = 1300; jobName = "Wind Archer";
        } else if (selection == 1400) {
            jobId = 1400; jobName = "Night Walker";
        } else if (selection == 1500) {
            jobId = 1500; jobName = "Thunder Breaker";
        }

        if (jobId > 0) {
            qm.forceStartQuest();
            qm.forceCompleteQuest();
            qm.changeJobById(jobId);
            qm.sendOk("Congratulations! You are now a #b" + jobName + "#k of the Cygnus Knights! May you serve the Empress well and bring honor to your order.");
        } else {
            qm.dispose();
        }
    } else if (status == 3) {
        qm.dispose();
    }
}

function end(mode, type, selection) {
    qm.dispose();
}
