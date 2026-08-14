import Pet from './Pet';
import Item from '../Inventory/Item';
import UIChatLog from '../UI/UIChatLog';
import ExpTable from '../Constants/ExpTable';
import { MapleInventoryType } from '../Constants/Inventory/MapleInventory';
import GameCanvas from '../GameCanvas';
import {
  loadPetData,
  loadBasicPetEffects,
} from './PetWzData';
import {
  matchCommand,
  pickVariant,
  pickLine,
  pickLineFromKeys,
} from './PetCommands';
import {
  MAX_PETS,
  PET_MAX_LEVEL,
  PET_HUNGRY_STANCE_AT,
  PET_STARVED_FULLNESS_LEFT,
  PET_RANDACT_MIN_MS,
  PET_RANDACT_MAX_MS,
  PET_RANDACT_CHANCE,
  PET_SLANG_CHANCE,
  PET_LOOT_INTERVAL_MS,
  PET_LONGRANGE_EXTRA_PX,
  PET_AUTO_POTION_INTERVAL_MS,
  PET_AUTO_POTION_RATIO,
  petDecayIntervalMs,
  petEquipSlotKey,
} from './PetConstants';

export interface PetSummary {
  itemId: number;
  name: string;
  level: number;
  equip?: number; // cosmetic pet-equip id, 0 = none (remotes render the overlay)
}

export interface PetAction {
  i: number;
  action: string; // stance name, or '__levelup'
  say?: string;
}

const requestSave = () => (window as any).__mySocket?.requestSave?.();

/** Life expired → doll. Never delete the slot; the item stays as a doll. */
export function dollifyPetItem(item: any, notice = true) {
  const data = item?.equipData;
  if (!data || data.dead) return;
  data.dead = true;
  data.summoned = false;
  if (notice) {
    UIChatLog.notice(`${data.petName ?? 'Your pet'} has turned back into a doll.`);
  }
}

const isExpired = (item: any) =>
  !!item?.equipData?.expireAt && item.equipData.expireAt <= Date.now();

/**
 * Owns all live pets: the local player's train (max 3, index i follows
 * i-1, index 0 follows the owner) and remote players' pets (locally
 * simulated followers of their lerped owners — positions are never sent
 * over the network, only the roster and one-shot actions).
 */
class PetManagerClass {
  pets: Pet[] = [];
  owner: any = null;

  private remotePets = new Map<any, Pet[]>();
  private pendingActions: PetAction[] = [];
  private _spawning = false;
  private _nextSlowCheckAt = 0;

  // ------------------------------------------------------------ summon

  /** Double-click entry point: summon if not out, despawn if out. */
  async toggleSummon(item: Item, owner: any): Promise<void> {
    const existing = this.pets.find((p) => p.itemRef === item);
    if (existing) {
      this.despawn(existing, 'user');
      return;
    }
    await this.summon(item, owner);
  }

  async summon(item: Item, owner: any, withEvolutionFx = false): Promise<Pet | null> {
    if (!owner) return null;
    const data: any = (item.equipData = item.equipData ?? {
      bonus: {},
      tuc: 0,
      level: 0,
    });

    let wz;
    try {
      wz = await loadPetData(item.itemId);
    } catch (e) {
      console.warn('[Pet] failed to load pet data', item.itemId, e);
      return null;
    }

    if (data.dead) {
      UIChatLog.notice(wz.descD);
      return null;
    }
    if (isExpired(item)) {
      dollifyPetItem(item);
      requestSave();
      return null;
    }
    if (this.pets.length >= MAX_PETS) {
      UIChatLog.system(`You can't summon more than ${MAX_PETS} pets.`);
      return null;
    }

    // Egg forms hatch on summon (evolReqItemID=0): roll the evolution
    // table, rewrite the item to the hatched species, then summon that
    if (wz.evolTargets.length && wz.info.evolReqItemID === 0) {
      const targetId = this.rollEvolTarget(wz.evolTargets);
      const hatched = await this.replacePetItem(owner, item, targetId, true);
      if (hatched) return this.summon(hatched, owner, true);
      return null;
    }

    // Initialize blob defaults on first summon
    if (data.petName == null) data.petName = wz.name;
    if (data.petLevel == null) data.petLevel = 1;
    if (data.closeness == null) data.closeness = 0;
    if (data.fullness == null) data.fullness = 100;
    if (data.expireAt == null && !wz.info.permanent && wz.info.life > 0) {
      data.expireAt = Date.now() + wz.info.life * 86400000;
    }

    this.owner = owner;
    let pet: Pet;
    try {
      pet = await Pet.fromItem(item, owner);
    } catch (e) {
      console.warn('[Pet] failed to create pet', item.itemId, e);
      return null;
    }
    const now = Date.now();
    pet.nextDecayAt = now + petDecayIntervalMs(pet.wz.info.hungry);
    pet.nextRandActAt = now + PET_RANDACT_MIN_MS;
    pet.lifeCheckpointAt = now;
    this.pets.push(pet);
    await this.loadEquipOverlay(pet);

    data.summoned = true;
    if (withEvolutionFx) {
      const eff = await loadBasicPetEffects();
      pet.playEffect(eff.Evolution ?? null, true);
    } else {
      pet.teleportToOwner(true);
    }
    requestSave();
    return pet;
  }

  despawn(pet: Pet, reason: 'user' | 'starved' | 'expired' | 'mapleave') {
    const idx = this.pets.indexOf(pet);
    if (idx >= 0) this.pets.splice(idx, 1);
    this.checkpointLife(pet);
    pet.destroy();
    if (reason !== 'mapleave' && pet.itemRef?.equipData) {
      (pet.itemRef.equipData as any).summoned = false;
      requestSave();
    }
  }

  despawnAll(reason: 'user' | 'mapleave' = 'user') {
    for (const pet of [...this.pets]) this.despawn(pet, reason);
  }

  /**
   * Idempotent respawn from the cash tab's summoned flags — runs after
   * every map load (covers login and portals; PetManager entities carry
   * over map changes, so live pets are just re-anchored, not rebuilt).
   */
  async spawnFromInventory(owner: any): Promise<void> {
    if (this._spawning || !owner?.inventory) return;
    this._spawning = true;
    try {
      this.owner = owner;
      const cash: any[] = owner.inventory.cash ?? [];
      for (const item of cash) {
        if (this.pets.length >= MAX_PETS) break;
        const data = item?.equipData;
        if (!data?.summoned || data.dead || isExpired(item)) continue;
        if (this.pets.some((p) => p.itemRef === item)) continue;
        await this.summon(item, owner);
      }
    } finally {
      this._spawning = false;
    }
  }

  /** Map change: re-anchor every pet at the owner with fresh physics state */
  onMapChange() {
    for (const pet of this.pets) {
      pet.pos.vx = 0;
      pet.pos.vy = 0;
      pet.pos.fh = null as any;
      pet.pos.isClimbing = false;
      pet.hover = false;
      pet.pos.flying = false;
      pet.stuckMs = 0;
      pet.balloonText = null;
      pet.activeEffect = null;
      if (this.owner) {
        pet.pos.x = this.owner.pos.x;
        pet.pos.y = this.owner.pos.y - 10;
      }
      this.checkpointLife(pet);
    }
    // Remote pets die with the map — their owners re-announce via player_list
    for (const [, pets] of this.remotePets) pets.forEach((p) => p.destroy());
    this.remotePets.clear();
  }

  // ------------------------------------------------------------ update/draw

  update(msPerTick: number) {
    const now = Date.now();

    for (let i = 0; i < this.pets.length; i++) {
      const pet = this.pets[i];
      // While the owner climbs, EVERY pet clings to the owner's back
      // (chaining behind a hovering pet would leave the rest dangling
      // mid-air); a small stack offset keeps a full train readable
      const ownerClimbing = this.owner?.pos?.isClimbing;
      const target = i === 0 || ownerClimbing ? this.owner : this.pets[i - 1];
      pet.hangYExtra = ownerClimbing ? i * 12 : 0;
      pet.update(msPerTick, target);
      this.tickFullness(pet, now);
      this.tickRandAction(pet, now);
      this.tickFunctionalEquips(pet, now);
    }

    // Slow checks: life expiry + limitedLife, once a minute
    if (now > this._nextSlowCheckAt) {
      this._nextSlowCheckAt = now + 60000;
      for (const pet of [...this.pets]) {
        this.checkpointLife(pet);
        const data: any = pet.itemRef?.equipData;
        if (!data) continue;
        const limited = pet.wz?.info.limitedLife;
        const lifeUp =
          isExpired(pet.itemRef) || (limited > 0 && (data.lifeUsedSec ?? 0) >= limited);
        if (lifeUp) {
          dollifyPetItem(pet.itemRef);
          this.despawn(pet, 'expired');
        }
      }
    }

    // Remote pets: simulate follow of their (lerped) owners; sweep pets
    // whose owner left the map — one mechanism covers player_left,
    // player_list removal, disconnect, and map loads
    const mapChars: any[] = (window as any).__MapleMap?.characters ?? [];
    for (const [character, pets] of this.remotePets) {
      if (!mapChars.includes(character)) {
        pets.forEach((p) => p.destroy());
        this.remotePets.delete(character);
        continue;
      }
      const remoteClimbing =
        character.pos?.isClimbing || character.stance === 'ladder' || character.stance === 'rope';
      for (let i = 0; i < pets.length; i++) {
        pets[i].hangYExtra = remoteClimbing ? i * 12 : 0;
        pets[i].update(msPerTick, i === 0 || remoteClimbing ? character : pets[i - 1]);
      }
    }
  }

  drawPets(canvas: GameCanvas, camera: any) {
    for (const [, pets] of this.remotePets) {
      for (const pet of pets) pet.draw(canvas, camera);
    }
    for (const pet of this.pets) pet.draw(canvas, camera);
  }

  drawOverlays(canvas: GameCanvas, camera: any) {
    for (const [, pets] of this.remotePets) {
      for (const pet of pets) pet.drawOverlays(canvas, camera);
    }
    for (const pet of this.pets) pet.drawOverlays(canvas, camera);
  }

  // ------------------------------------------------------------ fullness

  private tickFullness(pet: Pet, now: number) {
    const data: any = pet.itemRef?.equipData;
    if (!data || pet.isRemote) return;
    if (!pet.nextDecayAt) pet.nextDecayAt = now + petDecayIntervalMs(pet.wz.info.hungry);
    if (now < pet.nextDecayAt) return;
    pet.nextDecayAt = now + petDecayIntervalMs(pet.wz.info.hungry);
    data.fullness = Math.max(0, (data.fullness ?? 100) - 1);

    if (data.fullness <= PET_HUNGRY_STANCE_AT && !pet.warnedHungry) {
      pet.warnedHungry = true;
      pet.playOneShot('hungry');
      UIChatLog.system(`${data.petName} is hungry. Feed it some pet food.`);
    }
    if (data.fullness <= 0) {
      // v83: a starved pet goes back home (not dead) and loses a bit of love
      data.closeness = Math.max(0, (data.closeness ?? 0) - 1);
      data.fullness = PET_STARVED_FULLNESS_LEFT;
      UIChatLog.system(`${data.petName} was starving and went back home...`);
      this.despawn(pet, 'starved');
    }
  }

  /**
   * Feed pet food (524xxxx). Returns true when the food was consumed.
   * Target: the hungriest summoned pet whose id is in the food's whitelist.
   */
  feedPet(foodItem: Item, slotIndex: number, owner: any): boolean {
    const spec: any = foodItem.node?.spec;
    if (!spec) {
      UIChatLog.system('This food has no effect.');
      return false;
    }
    const inc = spec.inc?.nValue ?? 100;
    const whitelist: number[] = [];
    for (const child of spec.nChildren ?? []) {
      if (child.nName === 'inc') continue;
      const petId = child.nValue;
      if (typeof petId === 'number' && petId > 0) whitelist.push(petId);
    }

    const eligible = this.pets.filter((p) => whitelist.includes(p.petId));
    if (!eligible.length) {
      UIChatLog.system('You have no pet that can eat this.');
      return false;
    }
    eligible.sort(
      (a, b) => ((a.data?.fullness ?? 100) - (b.data?.fullness ?? 100)) || this.pets.indexOf(a) - this.pets.indexOf(b)
    );
    const pet = eligible[0];
    const data: any = pet.itemRef.equipData;
    const band =
      pet.wz.food.find((f) => (data.petLevel ?? 1) >= f.l0 && (data.petLevel ?? 1) <= f.l1) ??
      pet.wz.food[0];

    const wasBelowFull = (data.fullness ?? 100) < 100;
    if (wasBelowFull) {
      data.fullness = Math.min(100, (data.fullness ?? 100) + inc);
      if (data.fullness > PET_HUNGRY_STANCE_AT) pet.warnedHungry = false;
      this.gainCloseness(pet, 1);
      const variant = pickVariant(band?.success ?? []);
      pet.playOneShot((pet.wz.stances.eat ? 'eat' : variant?.act) || 'rest0');
      const line = pickLine(pet.wz, variant);
      if (line) pet.say(line);
      const eatSound = pet.wz.sounds.eat;
      if (eatSound) {
        import('../Audio/PlayAudio').then((m) => m.default(eatSound));
      }
    } else {
      const variant = pickVariant(band?.fail ?? []);
      if (variant) pet.playOneShot(variant.act);
      const line = pickLine(pet.wz, variant);
      if (line) pet.say(line);
    }

    // Food is consumed on success AND on an already-full refusal (v83)
    if (foodItem.quantity > 1) {
      foodItem.quantity -= 1;
      requestSave();
    } else {
      owner?.inventory?.removeAt?.(MapleInventoryType.CASH, slotIndex);
    }
    return true;
  }

  // ------------------------------------------------------------ closeness

  gainCloseness(pet: Pet, amount: number) {
    const data: any = pet.itemRef?.equipData;
    if (!data || pet.isRemote) return;
    data.closeness = Math.max(0, (data.closeness ?? 0) + amount);
    void this.checkLevelUp(pet);
  }

  private async checkLevelUp(pet: Pet) {
    const data: any = pet.itemRef?.equipData;
    if (!data) return;
    let leveled = false;
    while (
      (data.petLevel ?? 1) < PET_MAX_LEVEL &&
      (data.closeness ?? 0) >= ExpTable.getClosenessNeededForLevel((data.petLevel ?? 1) + 1)
    ) {
      data.petLevel = (data.petLevel ?? 1) + 1;
      leveled = true;
    }
    if (!leveled) return;
    const eff = await loadBasicPetEffects();
    pet.playEffect(eff.LevelUp ?? null, true);
    const sound = pet.wz.sounds.levelup;
    if (sound) import('../Audio/PlayAudio').then((m) => m.default(sound));
    const line = pet.wz.dialog.e_levelup;
    if (line) pet.say(line);
    UIChatLog.notice(`${data.petName} reached level ${data.petLevel}!`);
    this.queueAction({ i: this.pets.indexOf(pet), action: '__levelup' });
    requestSave();
  }

  // ------------------------------------------------------------ chat commands

  /** Called for every chat line the local player sends */
  onOwnerChat(msg: string) {
    for (const pet of this.pets) {
      const data: any = pet.itemRef?.equipData;
      if (!data || !pet.wz) continue;
      const level = data.petLevel ?? 1;
      const entry = matchCommand(msg, pet.wz, level);
      if (entry) {
        const success = Math.random() * 100 < entry.prob;
        const variant = pickVariant(success ? entry.success : entry.fail);
        if (variant) {
          pet.playOneShot(variant.act);
          const line = pickLine(pet.wz, variant);
          if (line) pet.say(line);
          this.queueAction({
            i: this.pets.indexOf(pet),
            action: variant.act,
            say: line ?? undefined,
          });
        }
        if (success) this.gainCloseness(pet, entry.inc);
      } else if (Math.random() < PET_SLANG_CHANCE) {
        const band =
          pet.wz.slang.find((s) => level >= s.l0 && level <= s.l1) ?? pet.wz.slang[0];
        if (band) {
          pet.playOneShot(band.act);
          const line = pickLineFromKeys(pet.wz, band.lineKeys);
          if (line) pet.say(line);
        }
      }
    }
  }

  private tickRandAction(pet: Pet, now: number) {
    if (!pet.nextRandActAt) pet.nextRandActAt = now + PET_RANDACT_MIN_MS;
    if (now < pet.nextRandActAt) return;
    pet.nextRandActAt =
      now + PET_RANDACT_MIN_MS + Math.random() * (PET_RANDACT_MAX_MS - PET_RANDACT_MIN_MS);
    if (pet.oneShotStance || pet.pos.left || pet.pos.right || pet.hover) return;
    if (Math.random() > PET_RANDACT_CHANCE) return;
    const level = (pet.itemRef?.equipData as any)?.petLevel ?? 1;
    const rand = pet.wz.randAction.find((r) => level >= r.l0 && level <= r.l1);
    if (rand) {
      pet.playOneShot(rand.act);
    } else {
      const options = ['chat', 'angry', 'cry', 'rest0'].filter((s) => pet.wz.stances[s]);
      if (options.length) {
        pet.playOneShot(options[Math.floor(Math.random() * options.length)]);
      }
    }
  }

  // ------------------------------------------------------------ functional equips

  /**
   * Item Pouch / Meso Magnet loot + Auto HP/MP Potion Pouches. Loot funnels
   * through MapleCharacter.pickupDrop — the single pickup path — so the
   * broadcast + inventory + chat-log flow is identical to a player pickup.
   */
  private tickFunctionalEquips(pet: Pet, now: number) {
    const flags = pet.equipFlags;
    if (!flags || pet.isRemote || !this.owner) return;

    if (
      (flags.pickupItem || flags.pickupMeso) &&
      !flags.ignorePickup &&
      now > pet.nextLootAt
    ) {
      pet.nextLootAt = now + PET_LOOT_INTERVAL_MS;
      const drops: any[] = (window as any).__MapleMap?.itemDrops ?? [];
      const grow = flags.longRange ? PET_LONGRANGE_EXTRA_PX : 0;
      const halfW = (pet.lastDrawWidth || 40) / 2 + grow;
      const left = pet.pos.x - halfW;
      const right = pet.pos.x + halfW;
      const top = (pet.lastDrawHeight ? pet.lastDrawTopY : pet.pos.y - 40) - 10;
      const bottom = pet.pos.y + 5;
      for (const drop of drops) {
        if (drop.isAlreadyPickedUp || !drop.hasLanded || !drop.frame || !drop.pos) continue;
        const isMeso = drop.id === 0;
        if (isMeso ? !flags.pickupMeso : !flags.pickupItem) continue;
        const dl = drop.pos.x - drop.frame.nWidth / 2;
        const dr = dl + drop.frame.nWidth;
        const dt = drop.pos.y - drop.frame.nHeight;
        const db = drop.pos.y;
        if (dr < left || dl > right || db < top || dt > bottom) continue;
        this.owner.pickupDrop?.(drop);
        break; // one drop per scan, like the original's leisurely pets
      }
    }

    if ((flags.consumeHP || flags.consumeMP) && now > pet.nextPotionAt) {
      pet.nextPotionAt = now + PET_AUTO_POTION_INTERVAL_MS;
      const owner = this.owner;
      // consumeItem works without the inventory window being open — the
      // hotkey bar already relies on that
      const invMenu = (window as any).MapStateInstance?.inventoryMenu;
      if (!invMenu?.consumeItem || owner.isDead) return;
      const useTab: any[] = owner.inventory?.use ?? [];
      const drink = (kind: 'hp' | 'mp') => {
        const idx = useTab.findIndex(
          (i: any) =>
            i &&
            (i.node?.spec?.[kind]?.nValue || i.node?.spec?.[`${kind}R`]?.nValue)
        );
        if (idx >= 0) {
          invMenu.consumeItem(useTab[idx], idx);
          pet.nextPotionAt = now + PET_AUTO_POTION_INTERVAL_MS * 2; // post-drink cooldown
        }
      };
      if (flags.consumeHP && owner.hp / owner.maxHp < PET_AUTO_POTION_RATIO) {
        drink('hp');
      } else if (flags.consumeMP && owner.mp / owner.maxMp < PET_AUTO_POTION_RATIO) {
        drink('mp');
      }
    }
  }

  // ------------------------------------------------------------ evolution

  rollEvolTarget(targets: { id: number; prob: number }[]): number {
    // Weight denominators are inconsistent across pets — roll against the sum
    const total = targets.reduce((s, t) => s + t.prob, 0) || 1;
    let roll = Math.random() * total;
    for (const t of targets) {
      roll -= t.prob;
      if (roll <= 0) return t.id;
    }
    return targets[targets.length - 1].id;
  }

  /**
   * Rewrite a pet item to a new species in place (egg hatch, evolution).
   * The blob carries over; petName resets to the new species name.
   */
  async replacePetItem(owner: any, petItem: Item, newItemId: number, resetName: boolean): Promise<Item | null> {
    const cash: any[] = owner?.inventory?.cash ?? [];
    const slot = cash.indexOf(petItem);
    if (slot < 0) return null;
    const blob: any = { ...(petItem.equipData ?? { bonus: {}, tuc: 0, level: 0 }) };
    if (resetName) {
      try {
        const wz = await loadPetData(newItemId);
        blob.petName = wz.name;
      } catch {
        blob.petName = undefined;
      }
    }
    try {
      const newItem = await Item.fromOpts({ itemId: newItemId, quantity: 1, equipData: blob });
      cash[slot] = newItem;
      requestSave();
      return newItem;
    } catch (e) {
      console.warn('[Pet] replacePetItem failed', newItemId, e);
      return null;
    }
  }

  // ------------------------------------------------------------ life clock

  private checkpointLife(pet: Pet) {
    const data: any = pet.itemRef?.equipData;
    if (!data || !pet.wz || pet.wz.info.limitedLife <= 0) return;
    const now = Date.now();
    if (pet.lifeCheckpointAt) {
      data.lifeUsedSec = (data.lifeUsedSec ?? 0) + (now - pet.lifeCheckpointAt) / 1000;
    }
    pet.lifeCheckpointAt = now;
  }

  // ------------------------------------------------------------ sync surface

  getSummonedSummary(): PetSummary[] {
    return this.pets.map((p) => ({
      itemId: p.petId,
      name: (p.itemRef?.equipData as any)?.petName ?? '',
      level: (p.itemRef?.equipData as any)?.petLevel ?? 1,
      equip: this.getPetEquips(p)['equip']?.id ?? 0,
    }));
  }

  getSummonedKey(): string {
    return this.getSummonedSummary()
      .map((p, i) => `${i}:${p.itemId}:${p.name}:${p.level}:${p.equip}`)
      .join(',');
  }

  private queueAction(action: PetAction) {
    if (action.i < 0) return;
    this.pendingActions.push(action);
  }

  hasPendingAction(): boolean {
    return this.pendingActions.length > 0;
  }

  consumePendingAction(): PetAction | null {
    return this.pendingActions.shift() ?? null;
  }

  /** Rebuild a remote player's pet train to match their announced roster */
  async syncRemotePets(character: any, roster: PetSummary[]): Promise<void> {
    const existing = this.remotePets.get(character) ?? [];
    existing.forEach((p) => p.destroy());
    this.remotePets.delete(character);
    if (!roster?.length) return;

    const pets: Pet[] = [];
    for (const entry of roster.slice(0, MAX_PETS)) {
      try {
        const fakeItem: any = {
          itemId: entry.itemId,
          quantity: 1,
          equipData: {
            bonus: {},
            tuc: 0,
            level: 0,
            petName: entry.name,
            petLevel: entry.level,
            fullness: 100,
            ...(entry.equip ? { petEquips: { equip: { id: entry.equip } } } : {}),
          },
        };
        const pet = await Pet.fromItem(fakeItem, character);
        pet.isRemote = true;
        pet.teleportToOwner(false);
        if (entry.equip) await this.loadEquipOverlay(pet);
        pets.push(pet);
      } catch (e) {
        console.warn('[Pet] remote pet load failed', entry.itemId, e);
      }
    }
    if (pets.length) this.remotePets.set(character, pets);
  }

  playRemoteAction(character: any, action: PetAction | null | undefined) {
    if (!action) return;
    const pets = this.remotePets.get(character);
    const pet = pets?.[action.i];
    if (!pet) return;
    if (action.action === '__levelup') {
      void loadBasicPetEffects().then((eff) => pet.playEffect(eff.LevelUp ?? null, true));
      const sound = pet.wz?.sounds.levelup;
      if (sound) import('../Audio/PlayAudio').then((m) => m.default(sound));
    } else {
      pet.playOneShot(action.action);
    }
    if (action.say) pet.say(action.say);
  }

  removeRemotePets(character: any) {
    const pets = this.remotePets.get(character);
    if (pets) {
      pets.forEach((p) => p.destroy());
      this.remotePets.delete(character);
    }
  }

  // ------------------------------------------------------------ pet equips

  /** Pet index the equip-panel is showing (clamped to summoned pets) */
  selectedPetIndex = 0;

  get selectedPet(): Pet | null {
    return this.pets[Math.min(this.selectedPetIndex, this.pets.length - 1)] ?? null;
  }

  /** The pet's worn-equip record, migrating the legacy single-slot form */
  getPetEquips(pet: Pet): Record<string, { id: number; expireAt?: number }> {
    const data: any = pet.itemRef?.equipData;
    if (!data) return {};
    if (!data.petEquips) data.petEquips = {};
    if (data.petEquipId) {
      data.petEquips[petEquipSlotKey(data.petEquipId)] = {
        id: data.petEquipId,
        ...(data.petEquipExpireAt ? { expireAt: data.petEquipExpireAt } : {}),
      };
      delete data.petEquipId;
      delete data.petEquipExpireAt;
    }
    return data.petEquips;
  }

  /**
   * Load overlay sprites (from the cosmetic 'equip' slot) and merge the
   * functional flags of EVERY worn equip (pickupItem, pickupMeso,
   * consumeHP, consumeMP, longRange, ignorePickup, sweepForDrop, ...)
   */
  async loadEquipOverlay(pet: Pet): Promise<void> {
    const equips = this.getPetEquips(pet);
    pet.equipOverlayNode = null;
    pet.equipFlags = {};
    const WZManager = (await import('../wz-utils/WZManager')).default;
    for (const [slotKey, entry] of Object.entries(equips)) {
      if (!entry?.id) continue;
      try {
        const root: any = await WZManager.get(`Character.wz/PetEquip/0${entry.id}.img`);
        for (const child of root.info?.nChildren ?? []) {
          if (typeof child.nValue === 'number' && child.nValue) {
            pet.equipFlags[child.nName] = child.nValue;
          }
        }
        if (slotKey === 'equip') {
          let node = root[String(pet.petId)];
          if (node?.nTagName === 'uol') node = node.nResolveUOL?.();
          pet.equipOverlayNode = node?.nTagName === 'imgdir' ? node : null;
        }
      } catch { /* missing img — flags/overlay just stay off */ }
    }
  }

  /**
   * Wear a pet equip (018xxxxx). Each panel slot holds one item; the
   * previous occupant returns to the cash tab. Targets the panel-selected
   * pet when possible, else the first eligible one.
   */
  async equipPetItem(item: Item, slotIndex: number, owner: any): Promise<void> {
    if (!this.pets.length) {
      UIChatLog.system('Summon a pet first.');
      return;
    }
    const WZManager = (await import('../wz-utils/WZManager')).default;
    let root: any = null;
    try {
      root = await WZManager.get(`Character.wz/PetEquip/0${item.itemId}.img`);
    } catch { /* functional-only equips may have no sprite dirs */ }

    const isCosmetic = Math.floor(item.itemId / 1000) === 1802;
    const supportsPet = (petId: number) => !!root?.[String(petId)];

    // Cosmetic gear needs sprites for the species; functional gear fits any
    const candidates = isCosmetic
      ? this.pets.filter((p) => supportsPet(p.petId))
      : [...this.pets];
    if (!candidates.length) {
      UIChatLog.system('None of your pets can wear this.');
      return;
    }
    const slotKey = petEquipSlotKey(item.itemId);
    const selected = this.selectedPet;
    const pet =
      (selected && candidates.includes(selected) ? selected : null) ??
      candidates.find((p) => !this.getPetEquips(p)[slotKey]) ??
      candidates[0];

    const equips = this.getPetEquips(pet);
    const prev = equips[slotKey];
    if (prev?.id) {
      await owner.inventory.addToInventory(
        prev.id,
        1,
        prev.expireAt ? { bonus: {}, tuc: 0, level: 0, expireAt: prev.expireAt } : undefined
      );
    }
    const expireAt = (item.equipData as any)?.expireAt;
    equips[slotKey] = { id: item.itemId, ...(expireAt ? { expireAt } : {}) };
    owner.inventory.removeAt(MapleInventoryType.CASH, slotIndex);
    await this.loadEquipOverlay(pet);
    UIChatLog.system(
      `${(pet.itemRef.equipData as any).petName} is now wearing the item.`
    );
    requestSave();
  }

  /** Take one worn equip off a pet, back into the cash tab */
  async unequipPetSlot(pet: Pet, slotKey: string, owner: any): Promise<void> {
    const equips = this.getPetEquips(pet);
    const entry = equips[slotKey];
    if (!entry?.id) return;
    if (!owner.inventory.canHold(entry.id, 1)) {
      UIChatLog.system('Please make room in your inventory first.');
      return;
    }
    await owner.inventory.addToInventory(
      entry.id,
      1,
      entry.expireAt ? { bonus: {}, tuc: 0, level: 0, expireAt: entry.expireAt } : undefined
    );
    delete equips[slotKey];
    await this.loadEquipOverlay(pet);
    requestSave();
  }

  /** Use a Rock of Evolution (5380000) on the first eligible summoned pet */
  async useEvolutionRock(rockItem: Item, slotIndex: number, owner: any): Promise<void> {
    const pet = this.pets.find((p) => {
      const data: any = p.itemRef?.equipData;
      return (
        p.wz?.evolTargets.length &&
        p.wz.info.evolReqItemID === rockItem.itemId &&
        (data?.petLevel ?? 1) >= p.wz.info.evolReqPetLvl
      );
    });
    if (!pet) {
      UIChatLog.system('No summoned pet is ready to evolve.');
      return;
    }
    const targetId = this.rollEvolTarget(pet.wz.evolTargets);
    const newItem = await this.replacePetItem(owner, pet.itemRef, targetId, true);
    if (!newItem) return;

    // Consume the rock
    if (rockItem.quantity > 1) {
      rockItem.quantity -= 1;
      requestSave();
    } else {
      owner.inventory.removeAt(MapleInventoryType.CASH, slotIndex);
    }

    // Respawn the entity in place as the new species
    const x = pet.pos.x;
    const y = pet.pos.y;
    this.despawn(pet, 'mapleave');
    (newItem.equipData as any).summoned = true;
    const evolved = await this.summon(newItem, owner, true);
    if (evolved) {
      evolved.pos.x = x;
      evolved.pos.y = y;
      UIChatLog.notice(
        `${(newItem.equipData as any).petName} evolved!`
      );
    }
  }
}

const PetManager = new PetManagerClass();
(window as any).__PetManager = PetManager;
export default PetManager;
