// v83 transportation route data, ported 1:1 from Cosmic's scripts/event/*.js
// (Boats, Trains, Cabin, Genie, Subway, AirPlane, Elevator + the instanced
// KerningTrain/Hak rides). Timing constants are the authentic rate-1 values;
// TransportationManager divides them by the dev travel rate.

export interface TransportLeg {
  waitingRoomMap: number;
  deckMap: number;
  cabinMaps: number[];
  arrivalMap: number;
  // Spawn portal at the arrival map — name or portal index
  arrivalPortal: string | number;
  invasionSpawn?: { x: number; y: number };
}

export interface InvasionConfig {
  chance: number;
  mobId: number;
  countPerDeck: number;
  minDelayAfterDepartMs: number;
  delayRangeMs: number;
  spawnAfterApproachMs: number;
  bgm: string;
  // oIds far above WZ spawn indices so they never collide (ride maps have
  // zero WZ mob spawns anyway)
  baseOId: number;
}

export interface TransportRouteConfig {
  key: string;
  cycleMs: number;      // full cycle; arrival == cycle wrap == next boarding open
  entryCloseMs: number; // gate closes ("entry" flips false)
  departMs: number;     // waiting rooms warp onto the vehicle
  legs: TransportLeg[];
  invasion?: InvasionConfig;
}

const MIN = 60 * 1000;

export const TRANSPORT_ROUTES: TransportRouteConfig[] = [
  {
    // Ellinia ↔ Orbis boat — the only route with the Crimson Balrog invasion
    key: 'Boats',
    cycleMs: 15 * MIN,
    entryCloseMs: 4 * MIN,
    departMs: 5 * MIN,
    legs: [
      {
        waitingRoomMap: 101000301, deckMap: 200090010, cabinMaps: [200090011],
        arrivalMap: 200000100, arrivalPortal: 0,
        invasionSpawn: { x: 339, y: 148 },
      },
      {
        waitingRoomMap: 200000112, deckMap: 200090000, cabinMaps: [200090001],
        arrivalMap: 101000300, arrivalPortal: 'come00',
        invasionSpawn: { x: -538, y: 143 },
      },
    ],
    invasion: {
      chance: 0.42, mobId: 8150000, countPerDeck: 2,
      minDelayAfterDepartMs: 3 * MIN, delayRangeMs: 1 * MIN,
      spawnAfterApproachMs: 5000, bgm: 'Bgm04/ArabPirate', baseOId: 9000,
    },
  },
  {
    // Orbis ↔ Ludibrium toy train
    key: 'Trains',
    cycleMs: 10 * MIN, entryCloseMs: 4 * MIN, departMs: 5 * MIN,
    legs: [
      { waitingRoomMap: 200000122, deckMap: 200090100, cabinMaps: [], arrivalMap: 220000100, arrivalPortal: 0 },
      { waitingRoomMap: 220000111, deckMap: 200090110, cabinMaps: [], arrivalMap: 200000100, arrivalPortal: 0 },
    ],
  },
  {
    // Orbis ↔ Leafre cabin ("Cabin_to_X" ARE the ride maps — no sub-cabin)
    key: 'Cabin',
    cycleMs: 10 * MIN, entryCloseMs: 4 * MIN, departMs: 5 * MIN,
    legs: [
      { waitingRoomMap: 200000132, deckMap: 200090200, cabinMaps: [], arrivalMap: 240000100, arrivalPortal: 0 },
      { waitingRoomMap: 240000111, deckMap: 200090210, cabinMaps: [], arrivalMap: 200000100, arrivalPortal: 0 },
    ],
  },
  {
    // Orbis ↔ Ariant genie (magic carpet)
    key: 'Genie',
    cycleMs: 10 * MIN, entryCloseMs: 4 * MIN, departMs: 5 * MIN,
    legs: [
      { waitingRoomMap: 200000152, deckMap: 200090400, cabinMaps: [], arrivalMap: 260000100, arrivalPortal: 1 },
      { waitingRoomMap: 260000110, deckMap: 200090410, cabinMaps: [], arrivalMap: 200000100, arrivalPortal: 0 },
    ],
  },
  {
    // Kerning City ↔ New Leaf City subway
    key: 'Subway',
    cycleMs: 5 * MIN, entryCloseMs: 50 * 1000, departMs: 60 * 1000,
    legs: [
      { waitingRoomMap: 600010004, deckMap: 600010005, cabinMaps: [], arrivalMap: 600010001, arrivalPortal: 0 },
      { waitingRoomMap: 600010002, deckMap: 600010003, cabinMaps: [], arrivalMap: 103000100, arrivalPortal: 0 },
    ],
  },
  {
    // Kerning City ↔ Singapore (CBD) airplane
    key: 'AirPlane',
    cycleMs: 6 * MIN, entryCloseMs: 4 * MIN, departMs: 5 * MIN,
    legs: [
      { waitingRoomMap: 540010100, deckMap: 540010101, cabinMaps: [], arrivalMap: 540010000, arrivalPortal: 0 },
      { waitingRoomMap: 540010001, deckMap: 540010002, cabinMaps: [], arrivalMap: 103000000, arrivalPortal: 7 },
    ],
  },
];

// Ludibrium Helios Tower elevator — its own shape: two boarding rooms, two
// car maps, 4-minute period. Timeline positions (rate-1 ms within period):
// up departs at 0, arrives at 60s; down departs at 120s, arrives at 180s.
// Boarding gate is open for the 60s before each departure.
export const ELEVATOR = {
  key: 'Elevator',
  periodMs: 4 * MIN,
  upBoardingMap: 222020110, upCarMap: 222020111,
  upArrivalMap: 222020200, upArrivalPortal: 0,
  downBoardingMap: 222020210, downCarMap: 222020211,
  downArrivalMap: 222020100, downArrivalPortal: 4,
  upDepartMs: 0, upArriveMs: 1 * MIN, downDepartMs: 2 * MIN, downArriveMs: 3 * MIN,
};

// Instanced timed rides: enter ride map → countdown → warp to destination.
// Level-triggered on "I am on this map", which also rescues players who log
// in stranded mid-ride.
export interface TimedRide {
  routeKey: string;
  rideMap: number;
  durationMs: number;
  destMap: number;
  destPortal: string | number;
  fromMaps: number[];
}

export const TIMED_RIDES: TimedRide[] = [
  { routeKey: 'KerningTrain', rideMap: 103000301, durationMs: 10000, destMap: 103000310, destPortal: 0, fromMaps: [103000100] },
  { routeKey: 'KerningTrain', rideMap: 103000302, durationMs: 10000, destMap: 103000100, destPortal: 0, fromMaps: [103000310] },
  { routeKey: 'Hak', rideMap: 200090300, durationMs: 60000, destMap: 250000100, destPortal: 0, fromMaps: [200000141] },
  { routeKey: 'Hak', rideMap: 200090310, durationMs: 60000, destMap: 200000141, destPortal: 0, fromMaps: [250000100] },
];

// Which route's departure each station clock counts down to (map has a
// `clock` node in its WZ data). 200000141/200000161 (Mu Lung/Ereve platforms)
// are excluded — their rides are on-demand / not yet implemented.
export const CLOCK_ROUTE_BY_MAP: Record<number, string> = {
  101000300: 'Boats', 101000400: 'Boats', 200000100: 'Boats', 200000111: 'Boats',
  200000121: 'Trains', 200000122: 'Trains', 220000100: 'Trains',
  200000131: 'Cabin', 200000132: 'Cabin', 240000100: 'Cabin',
  200000151: 'Genie', 200000152: 'Genie', 260000100: 'Genie',
};

// Maps whose `shipObj` node is the docked vessel that slides out at takeoff
// and back in before arrival (shipKind=0), keyed to the schedule that drives it.
export const SHIP_ROUTE_BY_MAP: Record<number, string> = {
  101000300: 'Boats', 101000400: 'Boats', 200000111: 'Boats',
  200000121: 'Trains', 220000110: 'Trains', 220000111: 'Trains',
  200000131: 'Cabin', 240000110: 'Cabin',
  200000151: 'Genie', 260000100: 'Genie',
};

// Boats deck maps whose shipObj (shipKind=1) is the enemy Balrog ship,
// visible only while an invasion is approaching/underway.
export const ENEMY_SHIP_MAPS = new Set<number>([200090000, 200090010]);
