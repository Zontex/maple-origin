export enum MapleInventoryType {
  UNDEFINED = 0,
  EQUIP = 1,
  USE = 2,
  SETUP = 3,
  ETC = 4,
  CASH = 5,
  CANHOLD = 6,
  EQUIPPED = -1,
}

export enum WzInventoryType {
  Pet = "Pet",
  Install = "Install",
  Consume = "Consume",
  Etc = "Etc",
  Cash = "Cash",
  Special = "Special",
}

// todo: fix this (multiple type variables)
// export const getInventoryByType = (type: number) => {
//   for (let type of Object.keys(MapleInventoryType)) {
//     if (MapleInventoryType[type] === type) {
//       return type;
//     }
//   }
//   return MapleInventoryType.UNDEFINED;
// };

const getMesosItemId = (mesoAmount: number) => {
  if (mesoAmount < 50) {
    return "09000000";
  } else if (mesoAmount < 100) {
    return "09000001";
  } else if (mesoAmount < 500) {
    return "09000002";
  } else {
    return "09000003";
  }
};

const isMeso = (itemId: string) => {
  const id = parseInt(itemId, 10);
  return id >= 9000000 && id <= 9000003;
};

// Live pets 5000000-5009999. Note: pets are the only item type with a whole
// .img per item at Item.wz/Pet/<unpadded id>.img — everything else groups
// under a 4-digit-prefix .img. Callers pass 8-digit padded ids, so the check
// must be numeric ("05000000"[0] is '0', never '5').
export const isPetItemId = (id: number): boolean =>
  id >= 5000000 && id < 5010000;

/** Pet food 5240000-5249999 (cash items; spec.inc + petId whitelist) */
export const isPetFoodItemId = (id: number): boolean =>
  id >= 5240000 && id < 5250000;

/** Pet equips: 1802xxx cosmetic, 1812xxx functional, 182x/183x labels */
export const isPetEquipItemId = (id: number): boolean => {
  const prefix = Math.floor(id / 10000);
  return prefix >= 180 && prefix <= 183;
};

export const EVOLUTION_ROCK_ID = 5380000;

const getWzNameFromInventoryId = (id: string): WzInventoryType => {
  const idAsString = id.toString();
  if (isPetItemId(parseInt(idAsString, 10))) {
    return WzInventoryType.Pet;
  } else {
    const secondDigit = idAsString[1];
    const secondDigitToWzInventoryType: Record<string, WzInventoryType> = {
      5: WzInventoryType.Cash,
      2: WzInventoryType.Consume,
      3: WzInventoryType.Install,
      4: WzInventoryType.Etc,
      9: WzInventoryType.Special,
    };
    return secondDigitToWzInventoryType[secondDigit];
  }
};

const getInventoryTypeFromItemId = (id: number): MapleInventoryType => {
  const category = Math.floor(id / 1000000);
  switch (category) {
    case 1: return MapleInventoryType.EQUIP;
    case 2: return MapleInventoryType.USE;
    case 3: return MapleInventoryType.SETUP;
    case 4: return MapleInventoryType.ETC;
    case 5: return MapleInventoryType.CASH;
    default: return MapleInventoryType.UNDEFINED;
  }
};

export const getByWZName = (name: string): MapleInventoryType => {
  if (name === "Install") {
    return MapleInventoryType.SETUP;
  } else if (name === "Consume") {
    return MapleInventoryType.USE;
  } else if (name === "Etc") {
    return MapleInventoryType.ETC;
  } else if (name === "Cash" || name === "Pet") {
    return MapleInventoryType.CASH;
  }
  return MapleInventoryType.UNDEFINED;
};

const MapleInventory = {
  // todo
  // getInventoryByType,
  getByWZName,
  getWzNameFromInventoryId,
  WzInventoryType,
  getMesosItemId,
  getInventoryTypeFromItemId,
  isMeso,
  isPetItemId,
  isPetFoodItemId,
  isPetEquipItemId,
  EVOLUTION_ROCK_ID,
};

export default MapleInventory;
