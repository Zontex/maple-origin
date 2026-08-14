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

#include "../UIDragElement.h"
#include "../Components/PopupSettingsChrome.h"

#include "../../Graphics/Text.h"
#include "../../Configuration.h"

#include <cstdint>

namespace ms
{
	// Party settings popup — UIWindow2.img/UserList/PopupSettings
	// (260x103). Two title sprites are baked into the dialog, one
	// for "Make" (creating a party) and one for "Settings" (editing
	// an existing one); we pick the right one at construction.
	class UIPartySettings : public UIDragElement<PosPARTYSETTINGS>
	{
	public:
		static constexpr Type TYPE = UIElement::Type::PARTYSETTINGS;
		static constexpr bool FOCUSED = false;
		static constexpr bool TOGGLED = true;

		UIPartySettings(bool make_mode);

		void draw(float inter) const override;
		void send_key(int32_t keycode, bool pressed, bool escape) override;

		UIElement::Type get_type() const override;

	protected:
		Button::State button_pressed(uint16_t buttonid) override;

	private:
		enum Buttons : uint16_t
		{
			BT_OK,        // bound to NX BtSave; "OK" to match other popups
			BT_CANCEL
		};

		bool make_mode;
		PopupSettingsChrome chrome;
	};
}
