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

#include "../UIElement.h"
#include "../Components/NotificationRow.h"
#include "../../Graphics/Text.h"

#include <cstdint>

namespace ms
{
	// Drawer popup that opens above BT_NOTICE on the status bar. Shows
	// the oldest pending NotificationCenter entry; resolving (Accept /
	// Decline via the BtOK / BtCancel sprites) advances to the next
	// entry. Auto-closes once the queue empties. Visually identical
	// to UIToastStack — both share the NotificationRow primitive.
	class UINotificationList : public UIElement
	{
	public:
		static constexpr Type TYPE = UIElement::Type::NOTIFICATIONLIST;
		static constexpr bool FOCUSED = false;
		static constexpr bool TOGGLED = true;

		UINotificationList();
		// `anchor_bottom_right` is a screen-space point — the popup
		// positions itself so its bottom-right corner sits there
		// (i.e. just above the BT_NOTICE button on the status bar).
		UINotificationList(Point<int16_t> anchor_bottom_right);

		void draw(float inter) const override;

		Cursor::State send_cursor(bool clicked, Point<int16_t> cursorpos) override;
		void send_key(int32_t keycode, bool pressed, bool escape) override;

		UIElement::Type get_type() const override;

	protected:
		Button::State button_pressed(uint16_t id) override;

	private:
		enum Buttons : uint16_t
		{
			BT_ACCEPT,
			BT_DECLINE
		};

		void layout();
		void resolve_front(bool yes);

		NotificationRow row;
		Point<int16_t> anchor;

		mutable Text empty_label;
	};
}
