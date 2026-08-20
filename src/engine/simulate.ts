/**
 * Timeline simulation.
 *
 * The combo is walked step by step on a clock. Each step advances time by what
 * it actually costs — a charged Q costs its charge plus dash travel, a basic
 * attack costs its windup and then locks the attack timer for 1/AS seconds —
 * so ordering genuinely matters: an armour shred applied by the third auto
 * changes every hit that lands after it, and nothing before it.
 *
 * Damage instances are recorded with the timestamp at which they land, which
 * is what makes the cumulative damage curve meaningful rather than decorative.
 */

import { getItemEffect, itemAmplifiers, itemRuntimes, type ItemRuntime } from '../model/itemEffects';
import { runeAmplifiers, runeRuntimes, type HitInfo, type RuneRuntime } from '../model/runes';
import { cooldownMultiplier, resolveChampionStats, sumStats, type StatBlock } from '../model/stats';
import type { ChampionModule, ChampionModuleContext } from '../model/champions/types';
import { cooldownValue } from '../model/champions/types';
import type { BasicAttackModifier, ChampionRuntime, DealDamageArgs, SimContext } from './context';
import { mitigate } from './damage';
import type {
  AbilitySlot,
  CritMode,
  DamageInstance,
  SimulationInput,
  SimulationResult,
  TimelineEvent,
} from './types';

interface TimedModifier {
  expiresAt: number;
  label: string;
}

interface ArmorShred extends TimedModifier {
  percent: number;
  flat: number;
}

interface TempStats extends TimedModifier {
  stats: Partial<StatBlock>;
}

interface TargetAmp extends TimedModifier {
  percent: number;
}

interface ScheduledEvent {
  at: number;
  run: () => void;
}

/** Guards against runaway combos if a step somehow never advances the clock. */
const MAX_SIMULATED_SECONDS = 120;

export function simulate(
  input: SimulationInput,
  module: ChampionModule,
  moduleCtx: ChampionModuleContext,
): SimulationResult {
  const instances: DamageInstance[] = [];
  const events: TimelineEvent[] = [];
  const warnings: string[] = [];

  const targetMaxHealth = Math.max(1, input.target.maxHealth);
  let targetCurrentHealth = targetMaxHealth * clamp01(input.target.currentHealthPercent);

  let time = 0;
  let nextAttackReadyAt = 0;
  let shieldGained = 0;
  let healingDone = 0;
  let instanceCounter = 0;
  let eventCounter = 0;
  /** Depth guard so rune and item procs cannot trigger each other forever. */
  let procDepth = 0;

  const shreds: ArmorShred[] = [];
  const tempStats: TempStats[] = [];
  const targetAmps: TargetAmp[] = [];
  const scheduled: ScheduledEvent[] = [];
  const cooldowns = new Map<AbilitySlot, number>();

  const championRuntime: ChampionRuntime = module.createRuntime(moduleCtx);
  const runes: { id: number; runtime: RuneRuntime }[] = runeRuntimes([
    ...input.attacker.runeIds,
    ...input.attacker.shardIds,
  ]);
  const items: { id: string; runtime: ItemRuntime }[] = itemRuntimes(input.attacker.itemIds);
  const amplifierRunes = runeAmplifiers([...input.attacker.runeIds, ...input.attacker.shardIds]);
  const amplifierItems = itemAmplifiers(input.attacker.itemIds);

  /* -------------------------------------------------------------- state views */

  function prune(): void {
    dropExpired(shreds, time);
    dropExpired(tempStats, time);
    dropExpired(targetAmps, time);
  }

  function currentStats() {
    prune();
    const bonus = sumStats([input.bonusStats, ...tempStats.map((entry) => entry.stats)]);
    return resolveChampionStats(input.championBaseStats, input.attacker.level, bonus);
  }

  /** Percent armour reductions stack multiplicatively, not additively. */
  function combinedShred(): { percent: number; flat: number } {
    prune();
    let remaining = 1;
    let flat = 0;
    for (const shred of shreds) {
      remaining *= 1 - clamp01(shred.percent);
      flat += shred.flat;
    }
    return { percent: 1 - remaining, flat };
  }

  function combinedTargetAmp(): number {
    prune();
    return targetAmps.reduce((acc, amp) => acc * (1 + amp.percent), 1) - 1;
  }

  /* ------------------------------------------------------------------- clock */

  function advanceTo(target: number): void {
    const clamped = Math.min(target, MAX_SIMULATED_SECONDS);
    while (scheduled.length > 0) {
      scheduled.sort((a, b) => a.at - b.at);
      const next = scheduled[0]!;
      if (next.at > clamped) break;
      scheduled.shift();
      time = Math.max(time, next.at);
      next.run();
    }
    time = Math.max(time, clamped);
  }

  function advance(seconds: number): void {
    if (seconds > 0) advanceTo(time + seconds);
  }

  /* ------------------------------------------------------------------ context */

  const ctx: SimContext = {
    get time() {
      return time;
    },
    get timings() {
      return input.timings;
    },
    get stats() {
      return currentStats();
    },
    get target() {
      return input.target;
    },
    get targetMaxHealth() {
      return targetMaxHealth;
    },
    get targetCurrentHealth() {
      return targetCurrentHealth;
    },
    rank: (slot) => input.attacker.ranks[slot] ?? 0,

    dealDamage(args) {
      return applyDamage(args);
    },

    applyArmorShred({ percent = 0, flat = 0, durationSeconds, label }) {
      // Re-applying the same source refreshes rather than stacks.
      const existing = shreds.find((entry) => entry.label === label);
      if (existing) {
        existing.percent = Math.max(existing.percent, percent);
        existing.flat = Math.max(existing.flat, flat);
        existing.expiresAt = time + durationSeconds;
      } else {
        shreds.push({ percent, flat, expiresAt: time + durationSeconds, label });
      }
      addEvent({
        kind: 'shred',
        label,
        detail:
          percent > 0
            ? `−${(percent * 100).toFixed(0)} % Rüstung für ${durationSeconds} s`
            : `−${flat.toFixed(0)} Rüstung für ${durationSeconds} s`,
      });
    },

    grantShield({ amount, durationSeconds, label }) {
      shieldGained += amount;
      addEvent({
        kind: 'shield',
        label,
        detail: `+${amount.toFixed(0)} Schild für ${durationSeconds} s`,
      });
    },

    applyTemporaryStats({ stats, durationSeconds, label }) {
      const existing = tempStats.find((entry) => entry.label.split(' · ')[0] === label.split(' · ')[0]);
      if (existing) {
        existing.stats = stats;
        existing.expiresAt = time + durationSeconds;
        existing.label = label;
      } else {
        tempStats.push({ stats, expiresAt: time + durationSeconds, label });
      }
      addEvent({ kind: 'buff', label, detail: `${durationSeconds} s` });
    },

    applyTargetAmplification({ percent, durationSeconds, label }) {
      targetAmps.push({ percent, expiresAt: time + durationSeconds, label });
      addEvent({ kind: 'buff', label, detail: `${durationSeconds} s` });
    },

    addEvent(event) {
      addEvent(event);
    },

    warn(message) {
      if (!warnings.includes(message)) warnings.push(message);
    },
  };

  function addEvent(event: Omit<TimelineEvent, 'id' | 'time'>): void {
    eventCounter += 1;
    events.push({ ...event, id: `ev${eventCounter}`, time });
  }

  /* ------------------------------------------------------------------ damage */

  function applyDamage(args: DealDamageArgs): DamageInstance {
    const stats = currentStats();
    const shred = combinedShred();

    // Amplifications stack multiplicatively with each other.
    let ampFactor = 1 + combinedTargetAmp();
    for (const rune of amplifierRunes) {
      ampFactor *= 1 + rune.amplify!(ctx, {
        sourceId: args.sourceId,
        sourceKind: args.sourceKind,
        type: args.type,
        isAbilityDamage: args.isAbilityDamage ?? false,
        triggersOnHit: args.triggersOnHit ?? false,
      });
    }
    for (const item of amplifierItems) {
      ampFactor *= 1 + item.amplify!(ctx, { type: args.type });
    }

    const result = mitigate({
      raw: args.amount,
      type: args.type,
      armor: {
        base: input.target.armor,
        flatReduction: shred.flat,
        percentReduction: shred.percent,
        percentPenetration: stats.armorPenPercent,
        flatPenetration: stats.flatArmorPen,
      },
      magicResist: {
        base: input.target.magicResist,
        flatReduction: 0,
        percentReduction: 0,
        percentPenetration: stats.magicPenPercent,
        flatPenetration: stats.magicPenFlat,
      },
      percentDamageReduction: input.target.percentDamageReduction,
      flatDamageReduction: input.target.flatDamageReduction,
      amplification: ampFactor - 1,
    });

    targetCurrentHealth = Math.max(0, targetCurrentHealth - result.mitigated);

    instanceCounter += 1;
    const instance: DamageInstance = {
      id: `dmg${instanceCounter}`,
      time,
      sourceId: args.sourceId,
      sourceLabel: args.sourceLabel,
      sourceKind: args.sourceKind,
      slot: args.slot,
      type: args.type,
      raw: result.raw,
      mitigated: result.mitigated,
      crit: (args.canCrit ?? false) && input.critMode === 'always',
      targetHpAfter: targetCurrentHealth,
      notes: [
        ...(args.notes ?? []),
        `effektive ${args.type === 'magic' ? 'MR' : 'Rüstung'}: ${result.effectiveResistance.toFixed(1)}`,
        ...(ampFactor !== 1 ? [`Verstärkung ×${ampFactor.toFixed(3)}`] : []),
      ],
    };
    instances.push(instance);

    // Vamp. Physical vamp applies to physical damage only; omnivamp to all.
    const vampRate =
      stats.omnivamp + (args.type === 'physical' ? stats.physicalVamp : 0) +
      (args.triggersOnHit ? stats.lifesteal : 0);
    if (vampRate > 0) healingDone += result.mitigated * vampRate;

    // Rune and item procs. Damage that itself came from a proc does not
    // re-trigger procs, which keeps Electrocute from feeding itself.
    if (procDepth === 0 && args.sourceKind !== 'rune' && args.sourceKind !== 'item') {
      const hit: HitInfo = {
        sourceId: args.sourceId,
        sourceKind: args.sourceKind,
        type: args.type,
        isAbilityDamage: args.isAbilityDamage ?? false,
        triggersOnHit: args.triggersOnHit ?? false,
        mitigated: result.mitigated,
        targetHealthPercentAfter: targetCurrentHealth / targetMaxHealth,
      };
      procDepth += 1;
      try {
        for (const { runtime } of runes) runtime.onHitLanded?.(ctx, hit);
        for (const { runtime } of items) runtime.onHitLanded?.(ctx, hit);
      } finally {
        procDepth -= 1;
      }
    }

    return instance;
  }

  /* ------------------------------------------------------------------ actions */

  function performAttack(): void {
    const stats = currentStats();
    advanceTo(Math.max(time, nextAttackReadyAt));
    const attackStart = time;

    const windup = input.timings.attackWindup / Math.max(0.1, stats.totalAttackSpeed);
    advance(windup);

    const modifier: BasicAttackModifier | null =
      championRuntime.modifyBasicAttack?.(ctx) ?? null;

    const statsAtHit = currentStats();
    const critFactor = critMultiplierFor(
      statsAtHit.critChance,
      statsAtHit.critMultiplier,
      input.critMode,
    );

    const baseAmount = modifier?.replacementDamage ?? statsAtHit.totalAttackDamage;
    const withBonus = baseAmount + (modifier?.bonusDamage ?? 0);

    applyDamage({
      sourceId: modifier?.slot ?? 'AA',
      sourceLabel: modifier?.label ?? 'Basisangriff',
      sourceKind: modifier?.slot ? 'ability' : 'attack',
      slot: modifier?.slot,
      type: modifier?.type ?? 'physical',
      amount: withBonus * critFactor,
      canCrit: true,
      triggersOnHit: true,
      notes: [
        ...(modifier?.notes ?? []),
        ...(critFactor !== 1 ? [`Krit-Faktor ×${critFactor.toFixed(3)}`] : []),
      ],
    });

    // On-hit riders from items land as their own instances.
    for (const { id, runtime } of items) {
      const rider = runtime.onBasicAttack?.(ctx);
      if (!rider || rider.amount <= 0) continue;
      applyDamage({
        sourceId: `item:${id}`,
        sourceLabel: rider.label,
        sourceKind: 'item',
        type: rider.type,
        amount: rider.amount,
        triggersOnHit: true,
        notes: rider.notes,
      });
    }

    championRuntime.onBasicAttackHit?.(ctx);

    nextAttackReadyAt = attackStart + 1 / Math.max(0.1, statsAtHit.totalAttackSpeed);
  }

  function castAbility(slot: AbilitySlot, chargeSeconds: number): void {
    const rank = input.attacker.ranks[slot] ?? 0;
    if (rank < 1) {
      ctx.warn(`${slot} ist nicht gelernt — Schritt übersprungen.`);
      return;
    }

    const readyAt = cooldowns.get(slot) ?? 0;
    if (time < readyAt) {
      ctx.warn(
        `${slot} war zum Zeitpunkt ${time.toFixed(2)} s noch ${(readyAt - time).toFixed(2)} s auf Abklingzeit — trotzdem gewirkt.`,
      );
    }

    const duration = championRuntime.castDuration?.(slot, ctx, { chargeSeconds }) ?? 0;
    addEvent({ kind: 'cast', label: `${slot} gewirkt`, detail: `${duration.toFixed(2)} s Wirkzeit` });
    advance(duration);

    championRuntime.castAbility?.(slot, ctx, { chargeSeconds });

    for (const { runtime } of items) runtime.onAbilityCast?.(ctx, slot);

    const meta = module.abilities.find((ability) => ability.slot === slot);
    const spell = meta?.ddragonId ? moduleCtx.spellById[meta.ddragonId] : undefined;
    const baseCooldown = cooldownValue(spell, rank, [0]).value;
    if (baseCooldown > 0) {
      cooldowns.set(slot, time + baseCooldown * cooldownMultiplier(currentStats().abilityHaste));
    }

    if (championRuntime.resetsAutoAttack?.(slot)) {
      nextAttackReadyAt = time;
      addEvent({ kind: 'info', label: 'Angriffstimer zurückgesetzt', detail: slot });
    }
  }

  function castSummoner(summonerId: string): void {
    const stats = currentStats();
    if (summonerId === 'SummonerDot') {
      // Ignite: true damage ticking over 5 seconds.
      const total = 70 + (410 - 70) * ((Math.min(18, stats.level) - 1) / 17);
      const perTick = total / 5;
      addEvent({ kind: 'cast', label: 'Entzünden', detail: `${total.toFixed(0)} über 5 s` });
      for (let tick = 1; tick <= 5; tick += 1) {
        const at = time + tick;
        scheduled.push({
          at,
          run: () =>
            applyDamage({
              sourceId: 'summoner:ignite',
              sourceLabel: `Entzünden (Tick ${tick}/5)`,
              sourceKind: 'summoner',
              type: 'true',
              amount: perTick,
            }),
        });
      }
      advance(input.timings.inputDelay);
      return;
    }

    if (summonerId === 'SummonerSmite') {
      if (input.target.unitType === 'champion') {
        ctx.warn('Verhaften/Schmettern wirkt nicht auf Champions — Schritt übersprungen.');
        return;
      }
      applyDamage({
        sourceId: 'summoner:smite',
        sourceLabel: 'Schmettern',
        sourceKind: 'summoner',
        type: 'true',
        amount: 900,
        notes: ['fester Wert gegen Monster'],
      });
      advance(input.timings.inputDelay);
      return;
    }

    ctx.warn(`Beschwörerzauber ${summonerId} ist nicht modelliert — Schritt übersprungen.`);
  }

  /* --------------------------------------------------------------- main loop */

  for (const step of input.combo) {
    if (time >= MAX_SIMULATED_SECONDS) {
      ctx.warn(`Simulation nach ${MAX_SIMULATED_SECONDS} s abgebrochen.`);
      break;
    }
    switch (step.action.kind) {
      case 'attack':
        performAttack();
        break;
      case 'ability':
        castAbility(step.action.slot, step.chargeSeconds ?? 0);
        break;
      case 'wait':
        advance(Math.max(0, step.action.seconds));
        break;
      case 'summoner':
        castSummoner(step.action.summonerId);
        break;
      case 'item': {
        const effect = getItemEffect(step.action.itemId);
        ctx.warn(
          effect
            ? `Aktives Item ${effect.name} ist nur passiv modelliert — Schritt übersprungen.`
            : 'Aktive Item-Effekte sind noch nicht modelliert — Schritt übersprungen.',
        );
        break;
      }
    }
  }

  // Let any scheduled damage-over-time finish before reporting.
  const lastScheduled = scheduled.reduce((max, entry) => Math.max(max, entry.at), time);
  advanceTo(lastScheduled);

  // A champion may still be holding an empowerment nothing consumed. That is a
  // legal combo, but it is almost always a mistake in the list rather than an
  // intention, so the champion gets a chance to say so.
  championRuntime.onComboEnd?.(ctx);

  const totalRaw = instances.reduce((sum, instance) => sum + instance.raw, 0);
  const totalMitigated = instances.reduce((sum, instance) => sum + instance.mitigated, 0);
  const killer = instances.find((instance) => instance.targetHpAfter <= 0);

  return {
    instances,
    events,
    totalRaw,
    totalMitigated,
    duration: time,
    killTime: killer?.time ?? null,
    targetHpRemaining: targetCurrentHealth,
    shieldGained,
    healingDone,
    warnings,
  };
}

/**
 * Crit is folded into damage as a multiplier rather than rolled, because a
 * calculator wants a reproducible number. `expected` gives the statistical
 * average, which is what build comparisons should use; `always` and `never`
 * bracket the best and worst case.
 */
function critMultiplierFor(chance: number, multiplier: number, mode: CritMode): number {
  if (mode === 'always') return multiplier;
  if (mode === 'never') return 1;
  return 1 + chance * (multiplier - 1);
}

function dropExpired(list: { expiresAt: number }[], now: number): void {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i]!.expiresAt <= now) list.splice(i, 1);
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
