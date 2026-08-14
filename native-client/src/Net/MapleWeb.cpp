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
#include "../Graphics/GraphicsGL.h"
#include "../IO/UI.h"
#include "../IO/Window.h"
#include "../IO/UITypes/UICharSelect.h"
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

	// Phase 2 senders land with the presence work
	void send_player_info() {}
	void send_player_update() {}
	void send_chat(const std::string&) {}

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
		if (Session::get().is_connected())
			send_heartbeat();
	}
}
#endif
