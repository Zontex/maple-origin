//////////////////////////////////////////////////////////////////////////////////
//	MapleWeb native client — JSON protocol layer (AGPL-3.0).					//
//	Speaks the MapleWeb server's JSON-over-WebSocket protocol; see			//
//	PROTOCOL.md at the repo root for the full wire spec.						//
//////////////////////////////////////////////////////////////////////////////////
#pragma once

#include "../MapleStory.h"

#ifdef USE_MW_JSON

#include <nlohmann/json.hpp>

#include <cstdint>
#include <string>

namespace ms::mw
{
	using json = nlohmann::json;

	// Session-wide client state for the MapleWeb protocol
	struct State
	{
		std::string player_id;      // uuid from the player_id handshake
		int64_t server_time_offset = 0;
		bool logged_in = false;
		int32_t user_id = 0;
		std::string username;       // cached for the resume flow
		std::string password;
		int32_t world_id = 0;
		int32_t character_id = 0;   // selected character (DB id)
		std::string character_name;
		bool in_game = false;       // Stage loaded, presence loop may run
		bool is_mob_host = false;
	};

	State& state();

	// Send any JSON message (adds nothing; caller builds the full object)
	void send(const json& msg);

	// --- C→S senders (Phase 1) ---
	void send_login(const std::string& username, const std::string& password);
	void send_get_characters(int32_t world_id);
	void send_check_name(int32_t world_id, const std::string& name);
	void send_delete_character(int32_t character_id);
	void send_select_character(int32_t character_id);
	void send_heartbeat();       // internally throttled to 1/s
	void send_get_player_list();

	// --- C→S senders (Phase 2, presence) ---
	void send_player_info();
	void send_player_update();   // change-gated + 50ms self-throttle
	void send_chat(const std::string& message);

	// Dispatch one received JSON text frame (called from Session::read)
	void forward(const std::string& text);

	// Per-frame tick from Session::read — heartbeat + deferred registration
	void tick();
}
#endif
