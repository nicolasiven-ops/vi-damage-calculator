/**
 * Item passives.
 *
 * Data Dragon gives us an item's stats (see `items.ts`) but its passives exist
 * only as prose. The ones that meaningfully change a damage combo are modelled
 * here by hand, keyed by Data Dragon item id.
 *
 * Any selected item without an entry still contributes its full stat line — it
 * is only the passive that goes unmodelled, and the analysis lists exactly
 * which items that applies to so no damage silently goes missing.
 *
 * Last reviewed against patch 26.16.
 */

import type { SimContext } from '../engine/context';
import type { AbilitySlot, DamageType } from '../engine/types';
import type { HitInfo } from './runes';

export interface ItemAttackRider {
  amount: number;
  type: DamageType;
  label: string;
  notes?: string[];
}

export interface ItemRuntime {
  /** Called after any damage instance the attacker deals. */
  onHitLanded?(ctx: SimContext, hit: HitInfo): void;
  /** Called whenever an ability is cast. */
  onAbilityCast?(ctx: SimContext, slot: AbilitySlot): void;
  /**
   * Extra damage folded into the current basic attack. Called once per attack,
   * so single-use effects may consume themselves here.
   */
  onBasicAttack?(ctx: SimContext): ItemAttackRider | null;
}

export interface ItemEffect {
  id: string;
  name: string;
  modelled: boolean;
  note: string;
  amplify?(ctx: SimContext, hit: { type: DamageType }): number;
  createRuntime?(): ItemRuntime;
}

/* ------------------------------------------------------------------ spellblade */

/**
 * Sheen and its upgrades: after casting an ability, the next basic attack
 * within 10 s deals bonus physical damage. 1.5 s internal cooldown.
 */
function spellblade(id: string, name: string, baseAdMultiplier: number, note: string): ItemEffect {
  return {
    id,
    name,
    modelled: true,
    note,
    createRuntime() {
      let armedUntil = -Infinity;
      let readyAt = 0;
      return {
        onAbilityCast(ctx) {
          if (ctx.time < readyAt) return;
          armedUntil = ctx.time + 10;
        },
        onBasicAttack(ctx) {
          if (ctx.time > armedUntil) return null;
          armedUntil = -Infinity;
          readyAt = ctx.time + 1.5;
          return {
            amount: baseAdMultiplier * ctx.stats.baseAttackDamage,
            type: 'physical',
            label: `${name} · Zauberklinge`,
            notes: [`${Math.round(baseAdMultiplier * 100)} % Basis-AD`],
          };
        },
      };
    },
  };
}

/* ----------------------------------------------------------------- definitions */

const BLACK_CLEAVER: ItemEffect = {
  id: '3071',
  name: 'Der schwarze Spalter',
  modelled: true,
  note: 'Physischer Schaden gewährt einen Stapel: −6 % Rüstung pro Stapel, maximal 5 Stapel (−30 %) für 6 s.',
  createRuntime() {
    let stacks = 0;
    let expiresAt = 0;
    return {
      onHitLanded(ctx, hit) {
        if (hit.type !== 'physical' || hit.mitigated <= 0) return;
        if (ctx.time > expiresAt) stacks = 0;
        if (stacks >= 5) {
          expiresAt = ctx.time + 6;
          return;
        }
        stacks += 1;
        expiresAt = ctx.time + 6;
        ctx.applyArmorShred({
          percent: 0.06 * stacks,
          durationSeconds: 6,
          label: `Der schwarze Spalter · ${stacks}/5`,
        });
      },
    };
  },
};

const BLADE_OF_THE_RUINED_KING: ItemEffect = {
  id: '3153',
  name: 'Klinge des untergegangenen Königs',
  modelled: true,
  note: 'Treffereffekt: 8 % des aktuellen Lebens des Ziels als physischer Schaden (Nahkampfwert).',
  createRuntime() {
    return {
      onBasicAttack(ctx) {
        const amount = ctx.targetCurrentHealth * 0.08;
        return {
          amount,
          type: 'physical',
          label: 'Klinge des untergegangenen Königs · Treffereffekt',
          notes: ['8 % des aktuellen Lebens'],
        };
      },
    };
  },
};

const TITANIC_HYDRA: ItemEffect = {
  id: '3748',
  name: 'Titanische Hydra',
  modelled: true,
  note: 'Treffereffekt: 3 + 1,5 % des maximalen Lebens von Vi als physischer Schaden. Der Flächenschaden ist im Einzelziel-Modell irrelevant.',
  createRuntime() {
    return {
      onBasicAttack(ctx) {
        const amount = 3 + 0.015 * ctx.stats.maxHealth;
        return {
          amount,
          type: 'physical',
          label: 'Titanische Hydra · Treffereffekt',
          notes: [`3 + 1,5 % von ${ctx.stats.maxHealth.toFixed(0)} Leben`],
        };
      },
    };
  },
};

const NASHORS_TOOTH: ItemEffect = {
  id: '3115',
  name: 'Nashors Zahn',
  modelled: true,
  note: 'Treffereffekt: 15 + 20 % Fähigkeitsstärke als magischer Schaden.',
  createRuntime() {
    return {
      onBasicAttack(ctx) {
        return {
          amount: 15 + 0.2 * ctx.stats.abilityPower,
          type: 'magic',
          label: 'Nashors Zahn · Treffereffekt',
        };
      },
    };
  },
};

const WITS_END: ItemEffect = {
  id: '3091',
  name: 'Wits Ende',
  modelled: true,
  note: 'Treffereffekt: 15–80 magischer Schaden, skalierend mit dem Level.',
  createRuntime() {
    return {
      onBasicAttack(ctx) {
        const t = (Math.min(18, Math.max(1, ctx.stats.level)) - 1) / 17;
        return {
          amount: 15 + (80 - 15) * t,
          type: 'magic',
          label: 'Wits Ende · Treffereffekt',
        };
      },
    };
  },
};

const LORD_DOMINIKS: ItemEffect = {
  id: '3036',
  name: 'Lord Dominiks Gruß',
  modelled: true,
  note: 'Riesentöter: bis zu +15 % physischer Schaden gegen Ziele mit mehr maximalem Leben als Vi.',
  amplify(ctx, hit) {
    if (hit.type !== 'physical') return 0;
    const excess = ctx.targetMaxHealth - ctx.stats.maxHealth;
    if (excess <= 0) return 0;
    // Ramps to the cap at +2000 max health difference.
    return Math.min(0.15, (excess / 2000) * 0.15);
  },
};

const ECLIPSE: ItemEffect = {
  id: '6692',
  name: 'Eklipse',
  modelled: true,
  note: 'Jeder 2. getrennte Angriff oder Fähigkeitstreffer auf denselben Champion verursacht 4 % des maximalen Lebens als physischen Schaden. 6 s Abklingzeit.',
  createRuntime() {
    let hits = 0;
    let readyAt = 0;
    return {
      onHitLanded(ctx, hit) {
        if (hit.mitigated <= 0 || ctx.time < readyAt) return;
        hits += 1;
        if (hits % 2 !== 0) return;
        ctx.dealDamage({
          sourceId: 'item:6692',
          sourceLabel: 'Eklipse',
          sourceKind: 'item',
          type: 'physical',
          amount: ctx.targetMaxHealth * 0.04,
          notes: ['4 % des maximalen Lebens des Ziels'],
        });
        readyAt = ctx.time + 6;
      },
    };
  },
};

const SUNDERED_SKY: ItemEffect = {
  id: '6610',
  name: 'Gespaltener Himmel',
  modelled: true,
  note: 'Lichtschildschlag: der erste Angriff gegen einen Champion trifft garantiert kritisch. Der Heilanteil fließt in die Heilungssumme ein.',
  createRuntime() {
    let used = false;
    let readyAt = 0;
    return {
      onBasicAttack(ctx) {
        if (used || ctx.time < readyAt) return null;
        used = true;
        readyAt = ctx.time + 8;
        // Modelled as the crit portion of one attack: the difference between a
        // normal and a critical strike.
        const bonus = ctx.stats.totalAttackDamage * (ctx.stats.critMultiplier - 1);
        return {
          amount: bonus,
          type: 'physical',
          label: 'Gespaltener Himmel · garantierter Krit',
          notes: [`+${((ctx.stats.critMultiplier - 1) * 100).toFixed(0)} % kritischer Zusatzschaden`],
        };
      },
    };
  },
};

const VOLTAIC_CYCLOSWORD: ItemEffect = {
  id: '6699',
  name: 'Voltaisches Zyklusschwert',
  modelled: true,
  note: 'Firmament: der aufgeladene Angriff verursacht 100 zusätzlichen physischen Schaden. Als einmalig pro Combo gerechnet.',
  createRuntime() {
    let used = false;
    return {
      onBasicAttack() {
        if (used) return null;
        used = true;
        return {
          amount: 100,
          type: 'physical',
          label: 'Voltaisches Zyklusschwert · Firmament',
        };
      },
    };
  },
};

const MURAMANA: ItemEffect = {
  id: '3042',
  name: 'Muramana',
  modelled: true,
  note: 'Schock: Fähigkeiten verursachen zusätzlich 3,5 % des maximalen Manas als physischen Schaden.',
  createRuntime() {
    return {
      onHitLanded(ctx, hit) {
        if (!hit.isAbilityDamage || hit.mitigated <= 0) return;
        ctx.dealDamage({
          sourceId: 'item:3042',
          sourceLabel: 'Muramana · Schock',
          sourceKind: 'item',
          type: 'physical',
          amount: ctx.stats.maxMana * 0.035,
          notes: [`3,5 % von ${ctx.stats.maxMana.toFixed(0)} Mana`],
        });
      },
    };
  },
};

const ALL: ItemEffect[] = [
  spellblade('3057', 'Glanz', 1.0, 'Zauberklinge: 100 % Basis-AD auf den nächsten Basisangriff.'),
  spellblade(
    '3078',
    'Dreifaltigkeitszwinge',
    2.0,
    'Zauberklinge: 200 % Basis-AD auf den nächsten Basisangriff.',
  ),
  spellblade(
    '3508',
    'Essenzräuber',
    1.0,
    'Zauberklinge: 100 % Basis-AD auf den nächsten Basisangriff.',
  ),
  spellblade('6632', 'Göttlicher Spalter', 1.25, 'Zauberklinge, hier mit 125 % Basis-AD gerechnet.'),
  BLACK_CLEAVER,
  BLADE_OF_THE_RUINED_KING,
  TITANIC_HYDRA,
  NASHORS_TOOTH,
  WITS_END,
  LORD_DOMINIKS,
  ECLIPSE,
  SUNDERED_SKY,
  VOLTAIC_CYCLOSWORD,
  MURAMANA,
];

const BY_ID = new Map<string, ItemEffect>(ALL.map((effect) => [effect.id, effect]));

export function getItemEffect(id: string): ItemEffect | undefined {
  return BY_ID.get(id);
}

export function hasModelledEffect(id: string): boolean {
  return BY_ID.has(id);
}

export function itemRuntimes(ids: string[]): { id: string; runtime: ItemRuntime }[] {
  return ids
    .map((id) => ({ id, effect: BY_ID.get(id) }))
    .filter((entry): entry is { id: string; effect: ItemEffect } =>
      Boolean(entry.effect?.createRuntime),
    )
    .map((entry) => ({ id: entry.id, runtime: entry.effect.createRuntime!() }));
}

export function itemAmplifiers(ids: string[]): ItemEffect[] {
  return ids
    .map((id) => BY_ID.get(id))
    .filter((effect): effect is ItemEffect => Boolean(effect?.amplify));
}

/** Item ids whose passive this calculator does not model. */
export function unmodelledItemIds(ids: string[]): string[] {
  return ids.filter((id) => !BY_ID.has(id));
}
