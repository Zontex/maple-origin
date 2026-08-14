//////////////////////////////////////////////////////////////////////////////////
//	MapleWeb native client — JSON-over-WebSocket transport (AGPL-3.0).		//
//////////////////////////////////////////////////////////////////////////////////
#include "SocketWebSocket.h"

#ifdef USE_MW_JSON

#include <ixwebsocket/IXNetSystem.h>
#include <ixwebsocket/IXWebSocket.h>

#include <iostream>

namespace ms
{
	SocketWebSocket::SocketWebSocket() : connected_flag(false)
	{
		ix::initNetSystem();
	}

	SocketWebSocket::~SocketWebSocket()
	{
		close();
	}

	bool SocketWebSocket::open(const std::string& url)
	{
		close();

		ws = std::make_unique<ix::WebSocket>();
		ws->setUrl(url);
		// Server pings us every 30s; IXWebSocket auto-pongs. Disable its own
		// client-side ping (the app-level heartbeat covers liveness).
		ws->disablePerMessageDeflate();

		ws->setOnMessageCallback([this](const ix::WebSocketMessagePtr& msg) {
			switch (msg->type)
			{
				case ix::WebSocketMessageType::Message:
				{
					std::lock_guard<std::mutex> lock(queue_mutex);
					incoming.push_back(msg->str);
					break;
				}
				case ix::WebSocketMessageType::Open:
					connected_flag = true;
					std::cout << "[MW] websocket connected\n";
					break;
				case ix::WebSocketMessageType::Close:
					connected_flag = false;
					std::cout << "[MW] websocket closed: "
						<< msg->closeInfo.code << " " << msg->closeInfo.reason << "\n";
					break;
				case ix::WebSocketMessageType::Error:
					connected_flag = false;
					std::cout << "[MW] websocket error: " << msg->errorInfo.reason << "\n";
					break;
				default:
					break;
			}
		});

		// IXWebSocket reconnects automatically by default; keep it — the
		// server re-sends player_id on every fresh connection and the
		// Session layer re-registers via the resume flow.
		ws->start();

		// Block briefly for the initial connect so init() can report a
		// meaningful result (the game shows its own retry dialog on failure)
		for (int i = 0; i < 50 && !connected_flag; i++)
		{
			std::this_thread::sleep_for(std::chrono::milliseconds(100));
		}

		return connected_flag;
	}

	bool SocketWebSocket::close()
	{
		if (ws)
		{
			ws->stop();
			ws.reset();
		}
		connected_flag = false;
		{
			std::lock_guard<std::mutex> lock(queue_mutex);
			incoming.clear();
		}
		return true;
	}

	bool SocketWebSocket::is_connected() const
	{
		return connected_flag;
	}

	bool SocketWebSocket::send(const std::string& text)
	{
		if (!ws || !connected_flag)
			return false;

		return ws->sendText(text).success;
	}

	bool SocketWebSocket::poll(std::string& out)
	{
		std::lock_guard<std::mutex> lock(queue_mutex);

		if (incoming.empty())
			return false;

		out = std::move(incoming.front());
		incoming.pop_front();
		return true;
	}
}
#endif
