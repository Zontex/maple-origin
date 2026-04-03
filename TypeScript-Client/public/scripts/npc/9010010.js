/* NPC 9010010 - Cassandra
   Event Guide — appears in most towns
*/
var status = 0;

function start() {
    cm.sendOk("Hello! I am Cassandra. If you want to know about the various events going on in MapleStory, I'm the one to talk to!");
    cm.dispose();
}

function action(mode, type, selection) {
    cm.dispose();
}
