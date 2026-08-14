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

#include "../OutPacket.h"

namespace ms
{
	// Packet to request character info
	// Opcode: CHAR_INFO_REQUEST(97)
	class CharInfoRequestPacket : public OutPacket
	{
	public:
		CharInfoRequestPacket(int32_t character_id) : OutPacket(OutPacket::Opcode::CHAR_INFO_REQUEST)
		{
			write_random();
			write_int(character_id);
		}
	};

	// Packet to give fame (+1) or defame (-1) a player
	// Opcode: GIVE_FAME(95)
	class GiveFamePacket : public OutPacket
	{
	public:
		GiveFamePacket(int32_t character_id, bool raise) : OutPacket(OutPacket::Opcode::GIVE_FAME)
		{
			write_int(character_id);
			write_byte(raise ? 1 : 0);
		}
	};
}