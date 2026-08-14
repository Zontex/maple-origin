//////////////////////////////////////////////////////////////////////////////////
//	This file is part of the continued Journey MMORPG client					//
//	Copyright (C) 2015-2019  Daniel Allendorf, Ryan Payton						//
//																				//
//	This program is free software: you can redistribute it and/or modify		//
//	it under the terms of the GNU Affero General Public License as published by	//
//	the Free Software Foundation, either version 3 of the License, or			//
//	(at your option) any later version.											//
//																				//
//	This program is distributed in the hope that it will be useful,				//
//	but WITHOUT ANY WARRANTY; without even the implied warranty of				//
//	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the				//
//	GNU Affero General Public License for more details.							//
//																				//
//	You should have received a copy of the GNU Affero General Public License	//
//	along with this program.  If not, see <https://www.gnu.org/licenses/>.		//
//////////////////////////////////////////////////////////////////////////////////
#pragma once

// MapleWeb: JSON-over-WebSocket transport to the MapleWeb server (see
// PROTOCOL.md). Replaces the v83 TCP + MapleCrypto stack entirely; legacy
// binary OutPacket sends become no-ops so unported systems degrade safely.
#define USE_MW_JSON

// If defined use Asio for networking, otherwise use Winsock.
//#define USE_ASIO

// Use cryptography for communication with the server
#ifndef USE_MW_JSON
#define USE_CRYPTO
#endif

// If defined use NX, otherwise use WZ.
#define USE_NX

// Run in debug mode
#define DEBUG