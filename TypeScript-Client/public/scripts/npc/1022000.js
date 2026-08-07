/* NPC 1022000 - Dances with Balrog
   Warrior Job Instructor — Victoria Road : Warriors' Sanctuary (102000003)

   First job advancement:  Beginner -> Warrior (100) at level 10, STR 35.
   Second job advancement: Warrior -> Fighter (110) / Page (120) / Spearman (130)
   at level 30, via the Proof of a Hero test.

   The second-job half of this file was missing: the whole rest of the chain
   ships with the client — the instructor at West Rocky Mountain IV
   (npc/1072000.js), his colleague in the hidden test maps (npc/1072004.js),
   map 108000300 with its 30 test monsters, and their Dark Marble drops — but
   nothing ever handed out the letter that starts it, so a level 30 warrior was
   told "keep training hard" forever.

   Quests 100003 (take the letter to the instructor) and 100004 (pass the test)
   have no Quest.wz entry by design: job advancement is server-side state in
   v83, which forceStartQuest/forceCompleteQuest already handle as bare flags.
*/
var status = 0;

function start() {
    var job = cm.getJobId();
    var level = cm.getLevel();

    if (job == 0) {
        if (level >= 10) {
            cm.sendNext("So you want to become a #bWarrior#k? You need to be strong in body and mind. Let me see if you have what it takes...");
        } else {
            cm.sendOk("You want to become a #bWarrior#k? You're still too weak for that. Come back when you've reached #bLevel 10#k.");
            cm.dispose();
        }
        return;
    }

    if (job == 100) {
        if (cm.haveItem(4031012)) {
            // Passed the test — the Proof of a Hero is the ticket back
            cm.sendNext("Oh...! You have #b#t4031012##k with you! So you passed the test... Excellent! I knew you had it in you. Now, it is time for you to choose the path you will walk from here on.");
            return;
        }
        if (level < 30) {
            cm.sendOk("Keep training hard, warrior. Once you reach #bLevel 30#k, come see me and I'll show you how to grow stronger still.");
            cm.dispose();
            return;
        }
        if (cm.isQuestStarted(100003) || cm.isQuestStarted(100004)) {
            cm.sendOk("You still have a test to finish. Take my letter to my colleague at #bWest Rocky Mountain IV#k, and don't come back until you've earned #b#t4031012##k.");
            cm.dispose();
            return;
        }
        cm.sendNext("You've grown strong, but strength alone does not make a hero. Are you ready to take the test that will decide the path you walk from here?");
        return;
    }

    cm.sendOk("Keep training hard, warrior. You'll become even stronger.");
    cm.dispose();
}

function action(mode, type, selection) {
    if (mode == -1) {
        cm.dispose();
        return;
    }
    if (mode == 0 && type > 0) {
        cm.sendOk("Take your time. Come back when you're ready.");
        cm.dispose();
        return;
    }
    status++;

    var job = cm.getJobId();

    // ---- Beginner -> Warrior ----
    if (job == 0) {
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
        return;
    }

    // ---- Warrior -> 2nd job ----
    if (job != 100) {
        cm.dispose();
        return;
    }

    if (cm.haveItem(4031012)) {
        // Choosing the path. The selection indices match the changeJob ids below.
        if (status == 1) {
            cm.sendSimple("Which path will you take?\r\n#b#L0#Fighter#l\r\n#L1#Page#l\r\n#L2#Spearman#l");
        } else if (status == 2) {
            var jobs = [110, 120, 130];
            var names = ["Fighter", "Page", "Spearman"];
            var pick = selection;
            if (pick < 0 || pick > 2) {
                cm.dispose();
                return;
            }
            cm.gainItem(4031012, -1);
            cm.completeQuest(100004);
            cm.changeJobById(jobs[pick]);
            cm.sendOk("From here on, you are a #b" + names[pick] + "#k. Your body and mind will grow stronger still — train hard, and make your name one that is remembered.");
            cm.dispose();
        }
        return;
    }

    // Handing out the letter that opens the test
    if (status == 1) {
        cm.sendYesNo("The test is held by a colleague of mine at #bWest Rocky Mountain IV#k, out past Perion. I'll write you a letter of introduction — he won't so much as look at you without it. Shall I?");
    } else if (status == 2) {
        cm.gainItem(4031008, 1);
        cm.startQuest(100003);
        cm.sendOk("Take this #b#t4031008##k to my colleague at #bWest Rocky Mountain IV#k. He'll send you somewhere the monsters give neither experience nor items — collect #b30 #t4031013##k from them, and his colleague inside will hand you #b#t4031012##k. Bring that back to me.");
        cm.dispose();
    }
}
