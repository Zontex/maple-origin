//////////////////////////////////////////////////////////////////////////////////
//	MapleWeb native client — JSON protocol layer (AGPL-3.0). See PROTOCOL.md.	//
//////////////////////////////////////////////////////////////////////////////////
#include "MapleWeb.h"

#ifdef USE_MW_JSON

#include "Session.h"
#include "Login.h"

#include "../Configuration.h"
#include "../Constants.h"
#include "../Timer.h"

#include "../Character/MapleStat.h"
#include "../Character/Look/EquipSlot.h"
#include "../Character/Inventory/InventoryType.h"

#include "../Gameplay/Stage.h"
#include "../Gameplay/Movement.h"
#include "../Graphics/GraphicsGL.h"
#include "../IO/UI.h"
#include "../IO/Window.h"
#include "../IO/UITypes/UICharSelect.h"
#include "../IO/UITypes/UIChatBar.h"
#include "../IO/UITypes/UILoginNotice.h"
#include "../IO/UITypes/UILoginWait.h"

#include <chrono>
#include <iostream>
#include <unordered_map>

namespace ms::mw
{
	namespace
	{
		State g_state;

		int64_t now_ms()
		{
			return std::chrono::duration_cast<std::chrono::milliseconds>(
				std::chrono::steady_clock::now().time_since_epoch()).count();
		}

		int64_t g_last_heartbeat = 0;

		// ------------------------------------------------------------------
		// Presence state (Phase 2)

		EquipSlot::Id equip_slot_from_browser(int32_t slot);

		// Remote players are keyed by uuid string on the wire but int32 cid
		// in the engine — allocate synthetic cids well above real DB ids
		struct RemotePlayer
		{
			int32_t cid = 0;
			int16_t last_x = 0;
			int16_t last_y = 0;
			std::string last_equip_key;
		};
		std::unordered_map<std::string, RemotePlayer> g_remotes;
		int32_t g_next_remote_cid = 900000001;

		// Cached from the select_character_result DTO — echoed verbatim in
		// player_info so the browser renders our gear without an inventory walk
		json g_my_equipped = json::array();
		int32_t g_my_level = 1;
		int32_t g_my_job = 0;
		int32_t g_my_hp = 50;
		int32_t g_my_maxhp = 50;
		int32_t g_my_mapid = 0;
		int32_t g_my_hair = 30030;
		int32_t g_my_face = 20000;
		int32_t g_my_skin = 0;

		bool g_needs_registration = false;
		int64_t g_last_update_sent = 0;
		double g_sent_x = 0, g_sent_y = 0;
		uint8_t g_sent_stancebyte = 255;

		// Char::State + facing → browser stance string
		std::string stance_to_browser(uint8_t statebyte)
		{
			uint8_t state = statebyte & ~1;
			switch (state)
			{
				case 2: return "walk1";
				case 4: return "stand1";
				case 6: return "jump";
				case 8: return "alert";
				case 10: return "prone";
				case 12: return "fly";     // swim — browser uses the fly stance
				case 14: return "ladder";
				case 16: return "rope";
				case 18: return "dead";
				case 20: return "sit";
				default: return "stand1";
			}
		}

		// Browser stance string → statebyte (flipped=true means facing right)
		uint8_t browser_to_stancebyte(const std::string& stance, bool flipped)
		{
			uint8_t state = 4; // stand
			if (stance.rfind("walk", 0) == 0) state = 2;
			else if (stance.rfind("stand", 0) == 0) state = 4;
			else if (stance == "jump") state = 6;
			else if (stance == "alert") state = 8;
			else if (stance.rfind("prone", 0) == 0) state = 10;
			else if (stance == "fly") state = 12;
			else if (stance == "ladder") state = 14;
			else if (stance == "rope") state = 16;
			else if (stance == "dead") state = 18;
			else if (stance == "sit") state = 20;
			// Attack stances (swing*/stab*/shoot*) render as stand in M1
			return flipped ? state : state + 1;
		}

		LookEntry look_from_player_data(const json& p)
		{
			LookEntry look{};
			look.female = false;
			look.skin = static_cast<uint8_t>(p.value("skin", 0));
			look.faceid = p.value("face", 20000);
			look.hairid = p.value("hair", 30030);
			if (p.contains("equipped") && p["equipped"].is_array() && !p["equipped"].empty())
			{
				for (const auto& eq : p["equipped"])
				{
					int32_t slot = eq.value("slot", -1);
					int32_t item_id = eq.value("itemId", 0);
					if (item_id <= 0)
						continue;
					EquipSlot::Id es = equip_slot_from_browser(slot >= 100 ? slot - 100 : slot);
					if (es == EquipSlot::Id::NONE)
						continue;
					if (slot >= 100)
						look.maskedequips[static_cast<int8_t>(es)] = item_id;
					else
						look.equips[static_cast<int8_t>(es)] = item_id;
				}
			}
			else
			{
				// Browser fallback outfit for empty lists
				look.equips[static_cast<int8_t>(EquipSlot::Id::TOP)] = 1040002;
				look.equips[static_cast<int8_t>(EquipSlot::Id::BOTTOM)] = 1060002;
				look.equips[static_cast<int8_t>(EquipSlot::Id::WEAPON)] = 1302000;
			}
			return look;
		}

		std::string equip_key_of(const json& p)
		{
			if (!p.contains("equipped") || !p["equipped"].is_array())
				return "";
			std::vector<std::string> parts;
			for (const auto& eq : p["equipped"])
				parts.push_back(std::to_string(eq.value("slot", 0)) + ":" +
					std::to_string(eq.value("itemId", 0)));
			std::sort(parts.begin(), parts.end());
			std::string key;
			for (const auto& s : parts) { key += s; key += ','; }
			return key;
		}

		// Browser slot numbers (PROTOCOL.md / browser EquipMenuSprite) →
		// HeavenClient EquipSlot ids, used to build the character look
		EquipSlot::Id equip_slot_from_browser(int32_t slot)
		{
			switch (slot)
			{
				case 0: return EquipSlot::Id::HAT;
				case 1: return EquipSlot::Id::FACE;
				case 2: return EquipSlot::Id::EYEACC;
				case 3: return EquipSlot::Id::EARACC;
				case 4: return EquipSlot::Id::TOP;
				case 5: return EquipSlot::Id::BOTTOM;
				case 6: return EquipSlot::Id::SHOES;
				case 7: return EquipSlot::Id::GLOVES;
				case 8: return EquipSlot::Id::CAPE;
				case 9: return EquipSlot::Id::SHIELD;
				case 10: return EquipSlot::Id::WEAPON;
				case 11: return EquipSlot::Id::RING1;
				case 12: return EquipSlot::Id::RING2;
				case 13: return EquipSlot::Id::RING3;
				case 14: return EquipSlot::Id::RING4;
				case 15: return EquipSlot::Id::MEDAL;
				case 16: return EquipSlot::Id::PENDANT1;
				case 18: return EquipSlot::Id::BELT;
				case 19: return EquipSlot::Id::TAMEDMOB;
				case 20: return EquipSlot::Id::SADDLE;
				default: return EquipSlot::Id::NONE;
			}
		}

		// ------------------------------------------------------------------
		// CharEntry building

		// character_list rows are raw SQLite rows: snake_case, equip_data is
		// a JSON string. See PROTOCOL.md §Auth.
		CharEntry char_entry_from_row(const json& row)
		{
			CharEntry entry{};
			entry.id = row.value("id", 0);

			entry.stats.name = row.value("name", std::string("?"));
			entry.stats.female = row.value("gender", 0) == 1;
			entry.stats.exp = 0;
			entry.stats.mapid = row.value("map_id", 0);
			entry.stats.portal = 0;
			entry.stats.stats[MapleStat::Id::LEVEL] = static_cast<uint16_t>(row.value("level", 1));
			entry.stats.stats[MapleStat::Id::JOB] = static_cast<uint16_t>(row.value("job_id", 0));
			entry.stats.stats[MapleStat::Id::STR] = static_cast<uint16_t>(row.value("str", 4));
			entry.stats.stats[MapleStat::Id::DEX] = static_cast<uint16_t>(row.value("dex", 4));
			entry.stats.stats[MapleStat::Id::INT] = static_cast<uint16_t>(row.value("int", 4));
			entry.stats.stats[MapleStat::Id::LUK] = static_cast<uint16_t>(row.value("luk", 4));

			entry.look.female = entry.stats.female;
			entry.look.skin = static_cast<uint8_t>(row.value("skin", 0));
			entry.look.faceid = row.value("face", 20000);
			entry.look.hairid = row.value("hair", 30030);

			if (row.contains("equipped") && row["equipped"].is_array())
			{
				for (const auto& eq : row["equipped"])
				{
					int32_t slot = eq.value("slot", -1);
					int32_t item_id = eq.value("item_id", 0);
					if (item_id <= 0)
						continue;
					if (slot >= 100)
					{
						// v83 cash cover layer (browser slot base+100)
						EquipSlot::Id es = equip_slot_from_browser(slot - 100);
						if (es != EquipSlot::Id::NONE)
							entry.look.maskedequips[static_cast<int8_t>(es)] = item_id;
					}
					else
					{
						EquipSlot::Id es = equip_slot_from_browser(slot);
						if (es != EquipSlot::Id::NONE)
							entry.look.equips[static_cast<int8_t>(es)] = item_id;
					}
				}
			}
			return entry;
		}

		// The FullCharacterDTO from select_character_result (camelCase,
		// stats nested, inventory grouped with null holes)
		CharEntry char_entry_from_dto(const json& dto)
		{
			CharEntry entry{};
			entry.id = dto.value("id", 0);

			const json& stats = dto.contains("stats") ? dto["stats"] : json::object();

			entry.stats.name = dto.value("name", std::string("?"));
			entry.stats.female = dto.value("gender", 0) == 1;
			entry.stats.exp = dto.value("exp", 0);
			entry.stats.mapid = dto.value("mapId", 0);
			entry.stats.portal = 0;
			entry.stats.stats[MapleStat::Id::LEVEL] = static_cast<uint16_t>(dto.value("level", 1));
			entry.stats.stats[MapleStat::Id::JOB] = static_cast<uint16_t>(stats.value("jobId", 0));
			entry.stats.stats[MapleStat::Id::STR] = static_cast<uint16_t>(stats.value("str", 4));
			entry.stats.stats[MapleStat::Id::DEX] = static_cast<uint16_t>(stats.value("dex", 4));
			entry.stats.stats[MapleStat::Id::INT] = static_cast<uint16_t>(stats.value("int", 4));
			entry.stats.stats[MapleStat::Id::LUK] = static_cast<uint16_t>(stats.value("luk", 4));
			entry.stats.stats[MapleStat::Id::HP] = static_cast<uint16_t>(dto.value("hp", 50));
			entry.stats.stats[MapleStat::Id::MAXHP] = static_cast<uint16_t>(dto.value("maxHp", 50));
			entry.stats.stats[MapleStat::Id::MP] = static_cast<uint16_t>(dto.value("mp", 5));
			entry.stats.stats[MapleStat::Id::MAXMP] = static_cast<uint16_t>(dto.value("maxMp", 5));
			entry.stats.stats[MapleStat::Id::AP] = static_cast<uint16_t>(stats.value("ap", 0));
			entry.stats.stats[MapleStat::Id::SP] = static_cast<uint16_t>(stats.value("sp", 0));
			entry.stats.stats[MapleStat::Id::FAME] = static_cast<uint16_t>(dto.value("fame", 0));

			entry.look.female = entry.stats.female;
			entry.look.skin = static_cast<uint8_t>(dto.value("skin", 0));
			entry.look.faceid = dto.value("face", 20000);
			entry.look.hairid = dto.value("hair", 30030);

			if (dto.contains("equipped") && dto["equipped"].is_array())
			{
				for (const auto& eq : dto["equipped"])
				{
					int32_t slot = eq.value("slot", -1);
					int32_t item_id = eq.value("item_id", 0);
					if (item_id <= 0)
						continue;
					EquipSlot::Id es = equip_slot_from_browser(slot >= 100 ? slot - 100 : slot);
					if (es == EquipSlot::Id::NONE)
						continue;
					if (slot >= 100)
						entry.look.maskedequips[static_cast<int8_t>(es)] = item_id;
					else
						entry.look.equips[static_cast<int8_t>(es)] = item_id;
				}
			}
			return entry;
		}

		// ------------------------------------------------------------------
		// Handlers

		void handle_player_id(const json& msg)
		{
			g_state.player_id = msg.value("id", std::string());
			int64_t server_time = msg.value("serverTime", static_cast<int64_t>(0));
			g_state.server_time_offset = server_time - now_ms();
			std::cout << "[MW] handshake: player_id=" << g_state.player_id << "\n";
		}

		void handle_login_result(const json& msg)
		{
			auto loginwait = UI::get().get_element<UILoginWait>();
			std::function<void()> okhandler = [](){};
			if (loginwait && loginwait->is_active())
				okhandler = loginwait->get_handler();

			UI::get().remove(UIElement::Type::LOGINNOTICE);
			UI::get().remove(UIElement::Type::LOGINWAIT);

			if (!msg.value("success", false))
			{
				std::cout << "[MW] login failed: " << msg.value("error", std::string()) << "\n";
				UI::get().emplace<UILoginNotice>(UILoginNotice::Message::WRONG_PASSWORD, okhandler);
				return;
			}

			g_state.logged_in = true;
			g_state.user_id = msg.value("userId", 0);
			std::cout << "[MW] logged in as " << msg.value("username", std::string()) << "\n";

			if (Setting<SaveLogin>::get().load())
				Setting<DefaultAccount>::get().save(g_state.username);

			// MapleWeb worlds are DB partitions; the browser client uses
			// Scania (world 0) by default. Skip the world-select screen and
			// go straight to that world's character list (M1).
			g_state.world_id = 0;
			send_get_characters(g_state.world_id);
		}

		void handle_character_list(const json& msg)
		{
			std::vector<CharEntry> characters;
			if (msg.contains("characters") && msg["characters"].is_array())
			{
				for (const auto& row : msg["characters"])
					characters.push_back(char_entry_from_row(row));
			}

			int8_t charcount = static_cast<int8_t>(characters.size());

			UI::get().remove(UIElement::Type::LOGINNOTICE);
			UI::get().remove(UIElement::Type::LOGINWAIT);
			UI::get().remove(UIElement::Type::LOGIN);

			// slots=3 (MapleWeb caps 3/world), pic=2 (PIC disabled)
			UI::get().emplace<UICharSelect>(characters, charcount, 3, 2);

			std::cout << "[MW] character list: " << static_cast<int>(charcount) << " characters\n";
		}

		void enter_game(const json& dto)
		{
			CharEntry entry = char_entry_from_dto(dto);
			g_state.character_id = entry.id;
			g_state.character_name = entry.stats.name;

			// View scaling — same logic as SetFieldHandler::handle
			int16_t res_w = Setting<Width>::get().load();
			int16_t res_h = Setting<Height>::get().load();
			float ui_scale = res_w / 1280.0f;
			if (ui_scale < 1.0f) ui_scale = 1.0f;
			if (ui_scale > 4.0f) ui_scale = 4.0f;
			Constants::Constants::get().set_ui_scale(ui_scale);
			Constants::Constants::get().set_viewwidth(res_w);
			Constants::Constants::get().set_viewheight(res_h);

			Stage::get().loadplayer(entry);
			Player& player = Stage::get().get_player();

			// Equipped gear → EQUIPPED inventory (positive slot = EquipSlot id)
			auto& invent = player.get_inventory();
			EnumMap<EquipStat::Id, uint16_t> nostats;
			if (dto.contains("equipped") && dto["equipped"].is_array())
			{
				for (const auto& eq : dto["equipped"])
				{
					int32_t slot = eq.value("slot", -1);
					int32_t item_id = eq.value("item_id", 0);
					if (item_id <= 0 || slot >= 100)
						continue; // cash covers ride the look only (M1)
					EquipSlot::Id es = equip_slot_from_browser(slot);
					if (es == EquipSlot::Id::NONE)
						continue;
					invent.add_equip(InventoryType::Id::EQUIPPED, static_cast<int16_t>(es),
						item_id, false, 0, 7, 0, nostats, "", 0, 0, 0, 0);
				}
			}

			// Inventory tabs (null holes → 1-based slots). equipData blobs are
			// opaque in M1 — items land with id+count only.
			auto load_tab = [&](const char* key, InventoryType::Id type) {
				if (!dto.contains("inventory") || !dto["inventory"].contains(key))
					return;
				const json& tab = dto["inventory"][key];
				if (!tab.is_array())
					return;
				int16_t slot = 0;
				for (const auto& item : tab)
				{
					slot++;
					if (item.is_null())
						continue;
					int32_t item_id = item.value("itemId", 0);
					int32_t qty = item.value("quantity", 1);
					if (item_id <= 0)
						continue;
					if (type == InventoryType::Id::EQUIP)
						invent.add_equip(type, slot, item_id, false, 0, 7, 0, nostats, "", 0, 0, 0, 0);
					else
						invent.add_item(type, slot, item_id, false, 0, static_cast<uint16_t>(qty), "", 0);
				}
			};
			load_tab("equip", InventoryType::Id::EQUIP);
			load_tab("use", InventoryType::Id::USE);
			load_tab("setup", InventoryType::Id::SETUP);
			load_tab("etc", InventoryType::Id::ETC);
			load_tab("cash", InventoryType::Id::CASH);

			invent.set_meso(dto.value("mesos", 0));

			// Visual gear from the EQUIPPED inventory
			for (auto eqslot : EquipSlot::values)
			{
				if (invent.get_item_id(InventoryType::Id::EQUIPPED, eqslot))
					player.change_equip(eqslot);
			}

			// Skills
			if (dto.contains("skills") && dto["skills"].is_array())
			{
				for (const auto& sk : dto["skills"])
				{
					int32_t skill_id = sk.value("skillId", 0);
					int32_t skill_level = sk.value("skillLevel", 0);
					int32_t master = sk.value("masterLevel", 0);
					if (skill_id > 0 && skill_level > 0)
						player.get_skills().set_skill(skill_id, skill_level, master, 0);
				}
			}

			player.recalc_stats(true);

			int32_t mapid = dto.value("mapId", 100000000);
			g_state.in_game = true;

			// Cache what player_info echoes to the browser peers
			g_my_equipped = json::array();
			if (dto.contains("equipped") && dto["equipped"].is_array())
			{
				for (const auto& eq : dto["equipped"])
				{
					int32_t item_id = eq.value("item_id", 0);
					if (item_id > 0)
						g_my_equipped.push_back({ {"slot", eq.value("slot", 0)}, {"itemId", item_id} });
				}
			}
			g_my_level = dto.value("level", 1);
			g_my_job = dto.contains("stats") ? dto["stats"].value("jobId", 0) : 0;
			g_my_hp = dto.value("hp", 50);
			g_my_maxhp = dto.value("maxHp", 50);
			g_my_mapid = mapid;
			g_my_hair = dto.value("hair", 30030);
			g_my_face = dto.value("face", 20000);
			g_my_skin = dto.value("skin", 0);
			g_needs_registration = true;

			// Fade into the field — same shape as SetFieldHandler::transition
			float fadestep = 0.025f;
			Window::get().fadeout(fadestep, [mapid]() {
				GraphicsGL::get().clear();
				Stage::get().load(mapid, 0);
				UI::get().enable();
				Timer::get().start();
				GraphicsGL::get().unlock();
				Stage::get().transfer_player();
			});
			GraphicsGL::get().lock();
			Stage::get().clear();
			Timer::get().start();

			std::cout << "[MW] entering map " << mapid << " as " << g_state.character_name << "\n";
		}

		void handle_select_character_result(const json& msg)
		{
			if (!msg.value("success", false))
			{
				std::cout << "[MW] select_character failed: "
					<< msg.value("error", std::string()) << "\n";
				return;
			}
			if (msg.contains("character"))
				enter_game(msg["character"]);
		}

		// ------------------------------------------------------------------
		// Presence handlers (Phase 2)

		void remove_remote(const std::string& uuid);

		void spawn_or_update_remote(const json& p)
		{
			const std::string uuid = p.value("id", std::string());
			if (uuid.empty() || uuid == g_state.player_id)
				return;
			if (p.value("mapId", -1) != g_my_mapid)
				return;

			int16_t x = static_cast<int16_t>(p.value("x", 0.0));
			int16_t y = static_cast<int16_t>(p.value("y", 0.0));
			const std::string stance = p.value("stance", std::string("stand1"));
			bool flipped = p.value("flipped", false);
			uint8_t statebyte = browser_to_stancebyte(stance, flipped);

			auto it = g_remotes.find(uuid);
			if (it == g_remotes.end())
			{
				RemotePlayer remote;
				remote.cid = g_next_remote_cid++;
				remote.last_x = x;
				remote.last_y = y;
				remote.last_equip_key = equip_key_of(p);

				LookEntry look = look_from_player_data(p);
				uint8_t level = static_cast<uint8_t>(p.value("level", 1));
				int16_t job = static_cast<int16_t>(p.value("job", 0));
				std::string name = p.value("name", std::string("Player"));

				Stage::get().get_chars().spawn(
					CharSpawn(remote.cid, look, level, job, name, statebyte, { x, y }));
				g_remotes.emplace(uuid, remote);
				std::cout << "[MW] remote player joined: " << name << "\n";
				return;
			}

			RemotePlayer& remote = it->second;

			// Gear change: despawn and let this same update respawn with the
			// new look (equip lists only ever arrive wholesale — PROTOCOL.md)
			std::string ekey = equip_key_of(p);
			if (!ekey.empty() && ekey != remote.last_equip_key)
			{
				remove_remote(uuid);
				spawn_or_update_remote(p);
				return;
			}

			std::vector<Movement> moves;
			moves.emplace_back(Movement::Type::ABSOLUTE, 0, x, y,
				remote.last_x, remote.last_y, 0, statebyte, 50);
			Stage::get().get_chars().send_movement(remote.cid, moves);
			remote.last_x = x;
			remote.last_y = y;
		}

		void remove_remote(const std::string& uuid)
		{
			auto it = g_remotes.find(uuid);
			if (it == g_remotes.end())
				return;
			Stage::get().get_chars().remove(it->second.cid);
			g_remotes.erase(it);
		}

		void handle_player_list(const json& msg)
		{
			if (!msg.contains("players") || !msg["players"].is_array())
				return;

			// The list includes ourselves; treat it as the authoritative
			// same-map roster
			std::unordered_map<std::string, bool> seen;
			for (const auto& p : msg["players"])
			{
				const std::string uuid = p.value("id", std::string());
				if (uuid == g_state.player_id)
					continue;
				seen[uuid] = true;
				spawn_or_update_remote(p);
			}
			std::vector<std::string> gone;
			for (const auto& [uuid, remote] : g_remotes)
				if (!seen.count(uuid))
					gone.push_back(uuid);
			for (const auto& uuid : gone)
				remove_remote(uuid);
		}

		void handle_chat_message(const json& msg)
		{
			if (!msg.contains("message"))
				return;
			const json& m = msg["message"];
			const std::string uuid = m.value("playerId", std::string());
			if (uuid == g_state.player_id)
				return; // server echoes our own chat back
			if (m.value("mapId", -1) != g_my_mapid)
				return;

			std::string text = m.value("message", std::string());
			auto it = g_remotes.find(uuid);
			if (it != g_remotes.end())
			{
				if (auto character = Stage::get().get_character(it->second.cid))
				{
					std::string line = character->get_name() + ": " + text;
					character->speak(line);
					chat::log(line, chat::LineType::WHITE);
					return;
				}
			}
			chat::log(text, chat::LineType::WHITE);
		}
	}

	// ----------------------------------------------------------------------

	State& state() { return g_state; }

	void send(const json& msg)
	{
		Session::get().send_json(msg.dump());
	}

	void send_login(const std::string& username, const std::string& password)
	{
		g_state.username = username;
		g_state.password = password;
		send({ {"type", "login"}, {"data", { {"username", username}, {"password", password} }} });
	}

	void send_get_characters(int32_t world_id)
	{
		send({ {"type", "get_characters"}, {"data", { {"worldId", world_id} }} });
	}

	void send_check_name(int32_t world_id, const std::string& name)
	{
		send({ {"type", "check_name"}, {"data", { {"worldId", world_id}, {"name", name} }} });
	}

	void send_delete_character(int32_t character_id)
	{
		send({ {"type", "delete_character"}, {"data", { {"characterId", character_id} }} });
	}

	void send_select_character(int32_t character_id)
	{
		send({ {"type", "select_character"}, {"data", { {"characterId", character_id} }} });
	}

	void send_heartbeat()
	{
		int64_t now = now_ms();
		if (now - g_last_heartbeat < 1000)
			return;
		g_last_heartbeat = now;
		send({ {"type", "heartbeat"} });
	}

	void send_get_player_list()
	{
		send({ {"type", "get_player_list"} });
	}

	void send_player_info()
	{
		if (!g_state.in_game || g_my_mapid <= 0)
			return;

		Player& player = Stage::get().get_player();
		Point<int16_t> pos = player.get_position();
		uint8_t statebyte = player.mw_stancebyte();

		json info = {
			{"id", g_state.player_id.empty() ? "unregistered" : g_state.player_id},
			{"x", pos.x()}, {"y", pos.y()},
			{"stance", stance_to_browser(statebyte)},
			{"frame", 0},
			{"flipped", (statebyte & 1) == 0},
			{"name", g_state.character_name},
			{"hair", g_my_hair},
			{"face", g_my_face},
			{"skin", g_my_skin},
			{"mapId", g_my_mapid},
			{"level", g_my_level},
			{"job", g_my_job},
			{"hp", g_my_hp}, {"maxHp", g_my_maxhp},
			{"attacking", false},
			{"equipped", g_my_equipped},
			{"pets", json::array()},
		};
		send({ {"type", "player_info"}, {"data", info} });
		g_needs_registration = false;
	}

	void send_player_update()
	{
		if (!g_state.in_game || g_my_mapid <= 0)
			return;

		Player& player = Stage::get().get_player();
		Point<int16_t> pos = player.get_position();
		uint8_t statebyte = player.mw_stancebyte();

		json update = {
			{"x", pos.x()}, {"y", pos.y()},
			{"stance", stance_to_browser(statebyte)},
			{"frame", 0},
			{"flipped", (statebyte & 1) == 0},
			{"mapId", g_my_mapid},
			{"attacking", false},
			{"onGround", true},
			{"vx", 0}, {"vy", 0},
			{"equipped", g_my_equipped},
		};
		send({ {"type", "player_update"}, {"data", update} });
	}

	void send_chat(const std::string& message)
	{
		if (!g_state.in_game || message.empty())
			return;
		send({ {"type", "chat_message"}, {"data", {
			{"playerId", g_state.player_id},
			{"message", message},
			{"mapId", g_my_mapid},
		}} });
	}

	void forward(const std::string& text)
	{
		json msg;
		try
		{
			msg = json::parse(text);
		}
		catch (const std::exception& e)
		{
			std::cout << "[MW] bad json from server: " << e.what() << "\n";
			return;
		}

		const std::string type = msg.value("type", std::string());

		try
		{
			if (type == "player_id") handle_player_id(msg);
			else if (type == "login_result") handle_login_result(msg);
			else if (type == "character_list") handle_character_list(msg);
			else if (type == "select_character_result") handle_select_character_result(msg);
			else if (type == "reregister") send_player_info();
			else if (type == "player_joined")
			{
				if (msg.contains("player")) spawn_or_update_remote(msg["player"]);
			}
			else if (type == "player_update")
			{
				if (msg.contains("player")) spawn_or_update_remote(msg["player"]);
			}
			else if (type == "player_list") handle_player_list(msg);
			else if (type == "player_left") remove_remote(msg.value("id", std::string()));
			else if (type == "chat_message") handle_chat_message(msg);
			else if (type == "party_notice")
				chat::log(msg.value("text", std::string()), chat::LineType::YELLOW);
			else if (type == "mob_host_assign")
				g_state.is_mob_host = msg.value("isHost", false);
			else if (type == "mob_state_batch" || type == "mob_death" ||
				type == "mob_respawn" || type == "item_drop" || type == "item_pickup" ||
				type == "reactor_hit" || type == "reactor_respawn" ||
				type == "player_level_up" || type == "player_hit_by_mob" ||
				type == "megaphone" || type == "party_update" || type == "party_invite" ||
				type == "best_items" || type == "save_character_result")
			{
				// Known but unhandled in M1 — arrive without spam
			}
			else if (type == "error")
				std::cout << "[MW] server error: " << msg.value("message", std::string()) << "\n";
			else
				std::cout << "[MW] unhandled message type: " << type << "\n";
		}
		catch (const std::exception& e)
		{
			// One bad message must not take the client down
			std::cout << "[MW] handler error for '" << type << "': " << e.what() << "\n";
		}
	}

	void tick()
	{
		if (!Session::get().is_connected())
			return;

		send_heartbeat();

		if (!g_state.in_game)
			return;

		// Deferred registration retry — unconditional, never gated on
		// movement (PROTOCOL.md; the browser learned this the hard way)
		if (g_needs_registration && !g_state.player_id.empty())
		{
			send_player_info();
			send_get_player_list();
		}

		// Presence updates: 50ms self-throttle + change gate
		int64_t now = now_ms();
		if (now - g_last_update_sent < 50)
			return;

		Player& player = Stage::get().get_player();
		Point<int16_t> pos = player.get_position();
		uint8_t statebyte = player.mw_stancebyte();

		bool pos_changed = std::abs(pos.x() - g_sent_x) > 1 || std::abs(pos.y() - g_sent_y) > 1;
		bool state_changed = statebyte != g_sent_stancebyte;

		if (pos_changed || state_changed)
		{
			send_player_update();
			g_last_update_sent = now;
			g_sent_x = pos.x();
			g_sent_y = pos.y();
			g_sent_stancebyte = statebyte;
		}
	}
}
#endif
