function enter(pi) {
    // Mai's training quests — sequential, each routes to its specific center
    if (pi.isQuestStarted(1041)) { pi.playPortalSound(); pi.warp(1010100, 4); return true; }
    if (pi.isQuestStarted(1042)) { pi.playPortalSound(); pi.warp(1010200, 4); return true; }
    if (pi.isQuestStarted(1043)) { pi.playPortalSound(); pi.warp(1010300, 4); return true; }
    if (pi.isQuestStarted(1044)) { pi.playPortalSound(); pi.warp(1010400, 4); return true; }

    // Must have completed training or Chief's Introduction to enter freely
    var trained = pi.isQuestCompleted(1044) || pi.isQuestCompleted(1043)
               || pi.isQuestCompleted(1042) || pi.isQuestCompleted(1041)
               || pi.isQuestCompleted(1040);
    if (!trained) return false;

    // Route by active quest needs

    // TC2: Red Snails (130101) — drop Red Snail Shell (4000016)
    // Quests: 1022 (Red Snail kills x7), 8000 (Red Snail Shell x10)
    if (pi.isQuestStarted(1022)) { pi.playPortalSound(); pi.warp(1010200, 4); return true; }

    // TC3: Slimes (210100) — drop Squishy Liquid (4000004)
    // Quests: 1025 (Squishy Liquid x1 + Mushroom Spore x5)
    if (pi.isQuestStarted(1025)) { pi.playPortalSound(); pi.warp(1010300, 4); return true; }

    // TC4: Pigs (1210100), Orange Mushrooms (1210102)
    // Quests: 1023 (Pig kills x2), 1045 (Orange Mushroom kill x1)
    if (pi.isQuestStarted(1023) || pi.isQuestStarted(1045)) { pi.playPortalSound(); pi.warp(1010400, 4); return true; }

    // TC1: Stumps (130100) — drop Tree Branch (4000003)
    // Quests: 1024 (Tree Branch x3)
    if (pi.isQuestStarted(1024)) { pi.playPortalSound(); pi.warp(1010100, 4); return true; }

    // TC2 fallback for New Life quest needing Red Snail Shells
    if (pi.isQuestStarted(8000)) { pi.playPortalSound(); pi.warp(1010200, 4); return true; }

    // Default: Training Center 1
    pi.playPortalSound(); pi.warp(1010100, 4); return true;
}
