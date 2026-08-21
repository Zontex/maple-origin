# src/Net — v83 binary protocol reference (inert)

This directory and `src/SessionManager.ts` are the client side of the genuine
MapleStory v83 wire protocol. **They are not used by the running game.** The
game speaks JSON over a plain WebSocket (`src/mysocket.ts` ↔ `server.js`);
nothing imports these modules at runtime (`SessionManager` is imported by
nobody, and only it imports `Net/*`).

They are kept, compiling, as the reference point for the planned Cosmic port
(ROADMAP Tier 7), where the server will accept the real v83 TCP/WebSocket
handshake and opcodes.

| File | What it documents |
|---|---|
| `Cryptography.ts` | v83 packet crypto: 4-byte header (`createHeader`/`checkLength`, `MAPLEVERSION = 83`), AES-OFB with the per-direction IV shuffle, and the "Maple" custom encrypt/decrypt rounds. IVs come from bytes 7..10 / 11..14 of the server hello. |
| `InPacket.ts` | Server→client opcodes known so far (`LOGIN_STATUS = 0`, `PING = 17`). |
| `OutPacket.ts` | Client→server packet builder (`writeByte/Short/Int/String`, `skip`) and opcodes (`LOGIN = 1`, `PONG = 24`). `dispatch()` hands bytes to SessionManager. |
| `Packets/LoginPacket.ts` | Layout of the v83 LOGIN packet: id, password, 6 zero bytes, the 4 volume-serial bytes (dummy here). |
| `../SessionManager.ts` | Binary WebSocket session: first frame = server hello (seeds the crypto), then header+payload framing, opcode dispatch (login status → `UILogin.showNotice` / TOS on reason 23, PING → PONG). |

Do not add runtime imports of these files. When the Cosmic port lands, the
intended shape is: port the server's `MapleAESOFB`/`MapleCustomEncryption` on
top of this `Cryptography`, grow the opcode enums from Cosmic's
`SendOpcode`/`RecvOpcode`, and replace the JSON login flow in `UILogin` with
`LoginPacket` + `SessionManager`.
