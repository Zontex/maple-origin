//////////////////////////////////////////////////////////////////////////////////
//	MapleWeb native client — JSON-over-WebSocket transport.					//
//	Part of the maple-origin project (AGPL-3.0), replacing the v83 TCP		//
//	socket layer of the vendored OpenStory/HeavenClient codebase.				//
//////////////////////////////////////////////////////////////////////////////////
#pragma once

#include "../MapleStory.h"

#ifdef USE_MW_JSON

#include <deque>
#include <memory>
#include <mutex>
#include <string>

namespace ix { class WebSocket; }

namespace ms
{
	// Wraps an IXWebSocket connection to the MapleWeb server. IXWebSocket
	// delivers messages on its own background thread; they are queued here
	// and drained from the game loop (Session::read), preserving the
	// engine's single-threaded message handling.
	class SocketWebSocket
	{
	public:
		SocketWebSocket();
		~SocketWebSocket();

		// url like "ws://localhost:3001"
		bool open(const std::string& url);
		bool close();

		bool is_connected() const;

		// Send one JSON text frame
		bool send(const std::string& text);

		// Pop the next queued message; empty optional-style: returns false
		// when the queue is empty
		bool poll(std::string& out);

	private:
		std::unique_ptr<ix::WebSocket> ws;
		mutable std::mutex queue_mutex;
		std::deque<std::string> incoming;
		bool connected_flag;
	};
}
#endif
