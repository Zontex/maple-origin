# MapleWeb Wire Protocol — C++ Client Porting Spec

Compiled 2026-08-14 from the live server (`server/`) and browser client
(`TypeScript-Client/src/mysocket.ts`). Exact field names matter — this protocol has
naming inconsistencies that must be reproduced byte-for-byte.

## Framing

- Plain WebSocket to `ws://localhost:3001` (server root, no path/subprotocol).
- Text frames, UTF-8 JSON. Every message: `{"type": "<string>", ...}`.
- `ws.maxPayload = 65536` — 64KiB inbound cap (matters for save_character later).
- Payload placement is NOT uniform:
  - most C→S nest under `data`; `heartbeat`/`request_host_check`/`get_player_list`/
    `party_create`/`party_leave` have NO data; `client_log`'s `data` is a STRING.
  - S→C varies: `data` (item/mob/reactor/megaphone/best_items), named keys
    (`player`, `players`, `message`, `party`, `character`, `characters`, `worlds`,
    `monster`), or flat (`player_id`, `mob_host_assign`, `reregister`, `*_result`,
    `party_notice/exp/warp`, `error`).
- Bad JSON → `{"type":"error","message":"Failed to process message"}`. Unknown type
  → silently ignored.

## Lifecycle

1. On connect the server immediately sends `{"type":"player_id","id":"<uuid>",
   "serverTime":<ms>}`. Store the id and `serverTime - now` offset. Reply with
   `player_info` as soon as a valid mapId exists (defer + retry every 33ms tick
   otherwise — retry lives in the tick body, NOT gated behind movement).
2. `{"type":"heartbeat"}` 1/s (liveness for host election + idle sweep).
3. Answer WS protocol ping frames with pong or be terminated within 30-60s.
4. Idle 10min → close code 4000 / reason `idle_timeout` → do NOT reconnect.
5. Other closes: reconnect after 3s, max 5 attempts. After reconnect while logged
   in: re-`login` → re-`select_character` (DISCARD the returned DTO — RAM is
   fresher) → `player_info` → `get_player_list`. Throttle resume to 1/10s.
6. S→C `{"type":"reregister"}` = server lost your registration → resend `player_info`.
7. Server autosaves ONLY on socket close, preferring the last full `save_character`
   payload; the fallback path saves stats-only from `player.info`.
8. Auth-gated requests (get_characters, select_character, ...) reply with NOTHING
   when not logged in — every request needs a client-side timeout (browser uses 10s).

## Auth + characters

- `{"type":"login","data":{username,password}}` → `{"type":"login_result",
  success,userId?,username?,error?}`.
- `{"type":"get_characters","data":{worldId}}` → `{"type":"character_list",worldId,
  characters:[<raw SQLite rows — SNAKE_CASE: id,name,level,job_id,hair,face,skin,
  gender,map_id,str,dex,int,luk,fame,equipped:[{slot,item_id,equip_data:<JSON
  STRING|null>}]>]}`. Also pushed unsolicited after create_character.
- `{"type":"check_name","data":{worldId,name}}` → `check_name_result` with
  `valid`/`taken`/`error` (NOT `success`).
- `{"type":"create_character","data":{worldId,name,hair,face,skin,gender,jobId,
  equips:[{slot,itemId}]}}` → `create_character_result {success,characterId?|error}`.
- `{"type":"select_character","data":{characterId}}` →
  `select_character_result {success,character:<DTO>}` — unlocks save_character.

### FullCharacterDTO (select_character_result.character)

```
id name worldId level exp
stats: { str dex int luk ap sp spByTier maxHp maxMp jobId level }
hp maxHp mp maxMp mapId posX posY mesos nx hair face skin gender fame
equipped:  [ {slot, item_id, equip_data: <JSON STRING|null>} ]   // snake_case!
inventory: { equip use setup etc cash }  // arrays WITH null holes at empty slots
           each: {itemId, quantity, equipData: <parsed object|null>}  // camelCase!
quests:    [ {quest_id, state(1|2), mob_progress:<JSON STRING>, completed_at} ]
skills:    [ {skillId, skillLevel, masterLevel} ]
keymap:    [ {keyCode:<string>, bindType(1=skill hotbar,2=item hotbar,3-5=keys),
              actionId} ]
```
Pets have no dedicated field — they are cash-tab items whose `equipData` object
carries pet state. Treat `equipData` as an OPAQUE json blob; round-trip untouched.

### save_character (NOT sent in M1 — guard it out entirely)

Server rules that matter later: invalid mapId → position dropped; level regression
→ level/exp/hp/mp block dropped; equipped-without-inventory → equipped dropped;
all-empty-state → item/skill/quest/keymap sections dropped; absent fields keep
stored values; inventory arrays are slot-indexed with null holes.

## In-game messages

### Outbound (C→S)

- `player_info` `data:{id,x,y,stance,frame,flipped,name,hair,face,skin,mapId,level,
  job,hp,maxHp,attacking:false,equipped:[{slot,itemId}],pets:[{itemId,name,level,
  equip}]}` — send after player_id / reregister / resume / map ready.
- `player_update` `data:{x,y,stance,frame,flipped,mapId,attacking,onGround,vx,vy,
  equipped,[emote],[pets],[petAction]}` — 33ms tick, self-throttle 50ms, and ONLY
  when changed: |Δx|>1 or |Δy|>1, or stance/frame/flipped changed, or attacking.
  Server merges ONLY x,y,stance,frame,flipped,attacking,emote(always),pets(if
  present),petAction(always) — it DISCARDS onGround/vx/vy/equipped. Server relays
  at most 1/33ms per player; ingress under 16ms is silently dropped.
  Map change is detected from mapId here (old-map player_left, new-map
  player_joined, host reassignment both sides — automatic).
- `chat_message` `data:{playerId,message,mapId}` — mapId REQUIRED (no server
  fallback); the server echoes to the sender too, self-filter by playerId.
- `get_player_list` (no data) → `player_list`.
- `request_host_check` (no data) — when non-host and mob state stale ≥5s; max 1/5s.
- `heartbeat`, `client_log` (data = string).
- M1 does NOT send: mob_state_batch, mob_death, mob_respawn, mob_damage_request,
  item_drop, item_pickup, reactor_*, player_hit_by_mob, player_level_up, party_*,
  megaphone, cash_*, save_character.

### Inbound (S→C)

- `player_joined` key `player` = full stored info (incl. equipped, pets).
- `player_update` key `player` = merged info. Lerp: teleport if |Δ|>200 else
  `0.3·ms/16` toward target, snap under 1px. Attack stances start with
  swing/stab/shoot → play once → `alert`. `stance:"dead"` = tombstone; any other
  stance revives. Equip key = sorted-joined `"{slot}:{itemId}"` strings
  (LEXICOGRAPHIC sort) — reattach all on change. Pet key =
  `"{i}:{itemId}:{name}:{level}:{equip??0}"` joined by `,`.
- `player_list` key `players` — INCLUDES SELF (skip own id); remove tracked
  players missing from it.
- `player_left` flat `id`.
- `mob_host_assign` flat `isHost` — M1: if true while alone, mobs just idle
  (native sends no batches yet).
- `mob_state_batch` `data:{mapId,mobs:[{oId,x,y,stance,frame,flipped,hp,maxHp,
  dying}]}` — teleport >300px else lerp; `dying` → death anim. Roster: mob absent
  from 30 consecutive batches → destroy; unknown oId → spawn from local spawn defs.
- `mob_death` / `mob_respawn` `data:{oId,mapId}`.
- `item_drop` `data:{dropId,itemId,amount,x,y,vx,vy,mapId,playerId}` — itemId 0 =
  mesos. `item_pickup` `data:{dropId,mapId,playerId}` → animate the drop away.
- `reactor_hit` / `reactor_respawn` `data:{oId,mapId}` (no playerId added).
- `chat_message` key `message` = `{playerId,message,mapId}`.
- `megaphone` `data:{playerId,itemId,message,name,look}` (world-wide, incl. self).
- `player_level_up` `data:{mapId,playerId,[level]}`; `player_hit_by_mob`
  `data:{mobOId,damage,isMiss,mapId,playerId}` (note mobOId!).
- `best_items` `data:{items:[{itemId,count}]}`.
- Party: `party_update` key `party` = `{id,leaderId,members:[{id,name,level,job,
  mapId}]}` or null; `party_invite` flat `{partyId,from:{id,name}}`;
  `party_notice` flat `text`; `party_exp` flat `exp`; `party_warp` flat `mapId`.
  M1: render party_notice to chat, ignore the rest gracefully.
- Legacy `monster_damage`/`monster_update`: dead paths — do not implement.
- Every handler must re-check `Number(mapId) === current map` and discard
  mismatches.

## Deterministic mob oIds (identity basis of all mob sync)

`oId` = 0-based index over: (map WZ/NX `life` children with `type=="m"`, in FILE
ORDER, mapped to `{id, x, y: cy ?? y, fh, rx0, rx1, mobTime}`) concatenated with
(the hardcoded boss-spawn table for that map — see browser
`Constants/BossSpawns.ts`). Reactors likewise use load-order oIds. Both clients
MUST derive identical ids from the same assets.

## Drop ids

Client-generated: `Date.now() + rand(0..9999) [+ index within multi-drop]`.
No server allocation; compared with `===`.

## Field-naming quick table

| concept | variants |
|---|---|
| mob id | `oId` (sync) · `mobOId` (player_hit_by_mob) · `targetId` (legacy) |
| item id | `itemId` (wire) · `item_id` (character_list/DTO equipped rows) |
| equip blob | `equipData` object (wire/inventory) · `equip_data` JSON string (equipped rows) |
| job | `job` (presence/party) · `jobId` (DTO/save/create) · `job_id` (list rows) |
| player id | `id` (player_id/joined/left/party) · `playerId` (data blobs) · `sourcePlayerId` (relayed damage) |
| quantity | `quantity` (inventory) · `amount` (item_drop) |
| name check | `valid`/`taken` (NOT `success`) |
