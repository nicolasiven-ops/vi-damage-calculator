/**
 * Parser for Riot's champion `bin` data, as served by CommunityDragon.
 *
 * ## Why this file exists
 *
 * Data Dragon does not ship ability damage any more. For every reworked kit —
 * which by now is most of them — `spell.effect` is an array of zeros and the
 * real numbers live in tooltip placeholders (`{{ totaldamage }}`) that Data
 * Dragon never resolves. Vi is a clean example: all four of her abilities
 * report 0 base damage and no ratios at all.
 *
 * The numbers do exist in machine-readable form, just not in Data Dragon. The
 * game's own `bin` files carry, per spell, a table of named values
 * (`DataValues`) and the formula trees that combine them
 * (`mSpellCalculations`). CommunityDragon converts those to JSON and serves
 * them per patch with `Access-Control-Allow-Origin: *`, so the browser can read
 * them exactly the way it reads Data Dragon.
 *
 * This file turns that into a small canonical model: a list of additive parts
 * plus multipliers, per named calculation. Evaluating it against a stat block
 * happens one layer up, in `model/spellcalc.ts`.
 *
 * ## Two array conventions in one file
 *
 * Riot indexes per-rank arrays two different ways, and the only discriminator
 * is the length:
 *
 *   - Seven entries → indexed by rank, index 0 holding the "not learned"
 *     value. `cooldownTime: [12, 12, 10.5, 9, 7.5, 6, 6]` is Vi's Q, whose
 *     real cooldowns are 12/10.5/9/7.5/6.
 *   - Six entries → indexed by rank − 1. `mana: [50, 60, 70, 80, 90, 80]` is
 *     the same spell, whose real costs are 50/60/70/80/90.
 *
 * Getting this backwards shifts every number by one rank, which is exactly the
 * kind of mistake that produces plausible-looking nonsense. It is therefore not
 * trusted: `validateGameData` in `gamedata.ts` re-derives cooldowns and costs
 * from the bin and compares them against Data Dragon, which does ship those two
 * fields correctly. If they disagree, the app refuses the bin data instead of
 * quietly computing wrong damage.
 *
 * ## What is deliberately not read
 *
 * `DataValuesModeOverride` holds per-mode replacements (`cherry` is Arena).
 * Those are ignored: this calculator models Summoner's Rift.
 */

/* --------------------------------------------------------- raw bin shapes */

/**
 * Riot renamed this container during season 15: up to patch 15.6 it is
 * `mDataValues` with `mName`/`mValues`, from 15.7 on it is `DataValues` with
 * `name`/`values`. Both spellings are read, since the contents are identical.
 */
interface RawDataValue {
  name?: string;
  values?: number[];
  mName?: string;
  mValues?: number[];
}

interface RawBreakpoint {
  mLevel?: number;
  mAdditionalBonusAtThisLevel?: number;
  mAdditionalBonusPerLevelAtThisLevel?: number;
}

interface RawPart {
  __type?: string;
  mDataValue?: string;
  mEffectIndex?: number;
  mStat?: number;
  mStatFormula?: number;
  mCoefficient?: number;
  mNumber?: number;
  mLevel1Value?: number;
  mInitialBonusPerLevel?: number;
  mBreakpoints?: RawBreakpoint[];
  mStartValue?: number;
  mEndValue?: number;
}

interface RawCalculation {
  __type?: string;
  mFormulaParts?: RawPart[];
  mMultiplier?: RawPart;
  mModifiedGameCalculation?: string;
  mDisplayAsPercent?: boolean;
}

interface RawEffectAmount {
  value?: number[];
}

interface RawSpell {
  DataValues?: RawDataValue[];
  mDataValues?: RawDataValue[];
  mEffectAmount?: RawEffectAmount[];
  mSpellCalculations?: Record<string, RawCalculation>;
  cooldownTime?: number[];
  mana?: number[];
  mMaxAmmo?: number[];
  mAmmoRechargeTime?: number[];
  mChannelDuration?: number[];
}

interface RawRecord {
  ObjectName?: string;
  mScriptName?: string;
  objectPath?: string;
  mSpell?: RawSpell;
}

/* ---------------------------------------------------------- canonical model */

/** Champion stats a formula part is allowed to read. */
export type StatKey = 'ad' | 'ap' | 'attackSpeed' | 'maxHealth';

/** Which slice of a stat a part scales with. */
export type StatScaling = 'total' | 'bonus';

export type CalcPart =
  /** A flat amount: either a literal or a named per-rank value. */
  | { kind: 'flat'; perRank: number[]; label: string }
  /** A ratio applied to a champion stat. */
  | { kind: 'stat'; stat: StatKey; scaling: StatScaling; perRank: number[]; label: string }
  /** Riot's champion-level curve: a level-1 value plus a per-level step, with breakpoints. */
  | {
      kind: 'byLevel';
      level1: number;
      perLevel: number;
      breakpoints: { level: number; add: number; perLevel: number | null }[];
    }
  /** Something this parser does not understand. Never silently treated as zero. */
  | { kind: 'unsupported'; reason: string };

export interface SpellCalculation {
  key: string;
  /** Additive parts. */
  parts: CalcPart[];
  /** Applied to the sum of `parts`, in order. */
  multipliers: CalcPart[];
  /** Riot renders this calculation as a percentage (Vi's W is a health ratio). */
  displayAsPercent: boolean;
  /** False when any part could not be read; the value must not be used then. */
  complete: boolean;
}

export interface GameSpell {
  /** Script name, e.g. `ViQ` — matches the Data Dragon spell id for most kits. */
  key: string;
  objectPath: string;
  /** Named per-rank values, exactly as shipped. Index with `pickRank`. */
  dataValues: Record<string, number[]>;
  /**
   * The unnamed per-rank slots, in bin order. Older patches reference these
   * from formulas instead of named values, and Data Dragon publishes the same
   * numbers one index further along in its `effect` array.
   */
  effectAmounts: (number[] | null)[];
  calculations: Record<string, SpellCalculation>;
  cooldown: number[] | null;
  cost: number[] | null;
  maxAmmo: number[] | null;
  ammoRechargeTime: number[] | null;
  channelDuration: number[] | null;
}

export interface ChampionGameData {
  championId: string;
  /** CommunityDragon patch path this came from, e.g. `16.16`. */
  patch: string;
  spells: Record<string, GameSpell>;
  /** `spell.calculation` keys that contained parts this parser could not read. */
  incomplete: string[];
}

/* ------------------------------------------------------------ enum mappings */

/**
 * `mStat` says which stat a scaling part reads. Riot ships a bare integer and
 * does not publish the enum — and the numbering is not stable across seasons.
 *
 * Only ids verified against a published tooltip are listed. Anything else is
 * rejected rather than guessed: a wrong guess yields a damage number that looks
 * entirely plausible and is silently wrong, which is worse for this app than a
 * maintained constant that is labelled as maintained.
 *
 * Verified against Vi, cross-checked with the official wiki:
 *   0  → ability power   (E: + 100 % AP)
 *   2  → attack damage   (Q: + 60 % bonus AD · R: + 90 % bonus AD · E: + 110 % AD)
 *   9  → attack speed    (E's modifier line: total attack speed − 1)
 *  12  → maximum health  (P: shields 12 % of maximum health) — from patch 15.7
 *  11  → maximum health  (P: shielded 14 % back then) — up to patch 15.6
 *
 * The health id moved between 15.6 and 15.7, found by walking Vi's passive
 * across the patches in between. Ids below 11 did not move: the same file that
 * says `mStat: 11` for health says `mStat: 2` for a value literally named
 * `ADRatio`.
 *
 * Adding an id: find a champion whose tooltip publishes that scaling, read the
 * id out of their bin, and check the computed number against the wiki first.
 */
interface StatTable {
  /** Oldest patch this numbering applies to, as [major, minor]. */
  since: [number, number];
  stats: Record<number, StatKey>;
}

const STAT_TABLES: StatTable[] = [
  { since: [15, 7], stats: { 0: 'ap', 2: 'ad', 9: 'attackSpeed', 12: 'maxHealth' } },
  { since: [0, 0], stats: { 0: 'ap', 2: 'ad', 9: 'attackSpeed', 11: 'maxHealth' } },
];

/** `16.16` → [16, 16]. Rolling folder names have no number and count as newest. */
function parsePatch(patch: string): [number, number] | null {
  const match = /^(\d+)\.(\d+)/.exec(patch);
  return match ? [Number(match[1]), Number(match[2])] : null;
}

function statTableFor(patch: string): Record<number, StatKey> {
  const parsed = parsePatch(patch);
  if (!parsed) return STAT_TABLES[0]!.stats;
  const [major, minor] = parsed;
  const table = STAT_TABLES.find(
    (entry) => major > entry.since[0] || (major === entry.since[0] && minor >= entry.since[1]),
  );
  return (table ?? STAT_TABLES[0]!).stats;
}

/**
 * `mStatFormula` picks which slice of the stat is used.
 *
 * Verified on Vi: absent (so 0) means *total* — her E scales with 110 % total
 * AD and her passive shields 12 % of maximum health — while 2 means *bonus*:
 * Q's 60 %, W's 3.5 % per 100 and R's 90 % are all bonus AD on the wiki.
 *
 * Id 1 is very likely "base", but no Vi ability uses it, so it stays rejected
 * until a champion with a published base-stat ratio confirms it.
 */
const SCALING_BY_ID: Record<number, StatScaling> = {
  0: 'total',
  2: 'bonus',
};

/* -------------------------------------------------------------- rank picking */

/**
 * Read the value for `rank` out of one of Riot's per-rank arrays.
 *
 * See the file header: seven-entry arrays are indexed by rank, shorter ones by
 * rank − 1. The choice is validated against Data Dragon at load time.
 */
export function pickRank(values: number[] | null | undefined, rank: number): number | null {
  if (!Array.isArray(values) || values.length === 0) return null;
  const index = values.length >= 7 ? rank : rank - 1;
  const clamped = Math.max(0, Math.min(values.length - 1, index));
  const value = values[clamped];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/* ------------------------------------------------------------------ parsing */

/** Riot leaves plenty of names hashed. Nothing can look those up, so skip them. */
function isHashedKey(key: string): boolean {
  return /^\{[0-9a-f]{8}\}$/.test(key);
}

function numbers(values: unknown): number[] | null {
  if (!Array.isArray(values)) return null;
  const clean = values.filter(
    (entry): entry is number => typeof entry === 'number' && Number.isFinite(entry),
  );
  return clean.length === values.length && clean.length > 0 ? clean : null;
}

/** Riot is inconsistent about casing in placeholder names, so match loosely. */
function lookupDataValue(dataValues: Record<string, number[]>, name: string): number[] | null {
  if (!name) return null;
  const direct = dataValues[name];
  if (direct) return direct;
  const wanted = name.toLowerCase();
  for (const [key, values] of Object.entries(dataValues)) {
    if (key.toLowerCase() === wanted) return values;
  }
  return null;
}

/** Everything one spell's formulas may refer to. */
interface SpellContext {
  dataValues: Record<string, number[]>;
  effectAmounts: (number[] | null)[];
  stats: Record<number, StatKey>;
}

function statPart(raw: RawPart, perRank: number[], label: string, ctx: SpellContext): CalcPart {
  // `mStat` is omitted for ability power, which is enum id 0.
  const statId = raw.mStat ?? 0;
  const stat = ctx.stats[statId];
  if (!stat) return { kind: 'unsupported', reason: `unbekannte Statuskennung mStat=${statId}` };

  // `mStatFormula` is omitted for total, which is enum id 0.
  const scalingId = raw.mStatFormula ?? 0;
  const scaling = SCALING_BY_ID[scalingId];
  if (!scaling) {
    return {
      kind: 'unsupported',
      reason: `unbekannte Skalierungskennung mStatFormula=${scalingId}`,
    };
  }

  return { kind: 'stat', stat, scaling, perRank, label };
}

function parsePart(raw: RawPart, ctx: SpellContext): CalcPart {
  const type = raw.__type ?? '(ohne Typ)';

  switch (type) {
    /** A named per-rank value, straight out of `DataValues`. */
    case 'NamedDataValueCalculationPart': {
      const name = raw.mDataValue ?? '';
      const values = lookupDataValue(ctx.dataValues, name);
      if (!values) {
        return { kind: 'unsupported', reason: `unbekannter Datenwert ${name || '(ohne Namen)'}` };
      }
      return { kind: 'flat', perRank: values, label: name };
    }

    /**
     * An unnamed per-rank slot. Kits that have not been converted to named
     * values yet reference these; Riot's own Data Dragon publishes the same
     * numbers as `effect[mEffectIndex]`, which is what the load-time check
     * compares them against.
     */
    case 'EffectValueCalculationPart': {
      const index = raw.mEffectIndex ?? 0;
      const values = ctx.effectAmounts[index - 1] ?? null;
      if (!values) {
        return { kind: 'unsupported', reason: `leerer Effektwert mEffectIndex=${index}` };
      }
      return { kind: 'flat', perRank: values, label: `Effekt ${index}` };
    }

    /** A literal. */
    case 'NumberCalculationPart':
      return { kind: 'flat', perRank: [raw.mNumber ?? 0], label: String(raw.mNumber ?? 0) };

    /** A stat ratio whose coefficient is a named per-rank value. */
    case 'StatByNamedDataValueCalculationPart': {
      const name = raw.mDataValue ?? '';
      const values = lookupDataValue(ctx.dataValues, name);
      if (!values) {
        return { kind: 'unsupported', reason: `unbekannter Datenwert ${name || '(ohne Namen)'}` };
      }
      return statPart(raw, values, name, ctx);
    }

    /** A stat ratio with a constant coefficient. */
    case 'StatByCoefficientCalculationPart':
      return statPart(raw, [raw.mCoefficient ?? 0], String(raw.mCoefficient ?? 0), ctx);

    /** Champion-level curve with breakpoints (Vi's passive cooldown). */
    case 'ByCharLevelBreakpointsCalculationPart': {
      const breakpoints = (raw.mBreakpoints ?? [])
        .filter((entry) => typeof entry.mLevel === 'number')
        .map((entry) => ({
          level: entry.mLevel as number,
          add: entry.mAdditionalBonusAtThisLevel ?? 0,
          perLevel: entry.mAdditionalBonusPerLevelAtThisLevel ?? null,
        }))
        .sort((a, b) => a.level - b.level);
      return {
        kind: 'byLevel',
        level1: raw.mLevel1Value ?? 0,
        perLevel: raw.mInitialBonusPerLevel ?? 0,
        breakpoints,
      };
    }

    /**
     * Straight interpolation from level 1 to level 18, expressed as a
     * breakpoint curve with a constant step — the same thing.
     */
    case 'ByCharLevelInterpolationCalculationPart': {
      const start = raw.mStartValue ?? 0;
      const end = raw.mEndValue ?? 0;
      return { kind: 'byLevel', level1: start, perLevel: (end - start) / 17, breakpoints: [] };
    }

    default:
      return { kind: 'unsupported', reason: `unbekannter Formelteil ${type}` };
  }
}

function parseCalculation(
  key: string,
  raw: RawCalculation,
  siblings: Record<string, RawCalculation>,
  ctx: SpellContext,
  seen: Set<string>,
): SpellCalculation {
  const multipliers: CalcPart[] = [];
  let parts: CalcPart[] = [];
  let displayAsPercent = raw.mDisplayAsPercent === true;

  if (raw.mMultiplier) multipliers.push(parsePart(raw.mMultiplier, ctx));

  if (raw.mModifiedGameCalculation) {
    // `GameCalculationModified` wraps another calculation: Vi's fully charged Q
    // is "TotalDamage × MaxDamageMult". Resolve the wrapped formula and keep the
    // multiplier chain in order.
    const target = raw.mModifiedGameCalculation;
    const base = siblings[target];
    if (seen.has(target)) {
      parts = [{ kind: 'unsupported', reason: `Ringverweis über ${target}` }];
    } else if (!base) {
      parts = [{ kind: 'unsupported', reason: `verweist auf unbekannte Berechnung ${target}` }];
    } else {
      seen.add(target);
      const resolved = parseCalculation(target, base, siblings, ctx, seen);
      parts = resolved.parts;
      multipliers.push(...resolved.multipliers);
      displayAsPercent = displayAsPercent || resolved.displayAsPercent;
    }
  } else {
    parts = (raw.mFormulaParts ?? []).map((part) => parsePart(part, ctx));
  }

  if (parts.length === 0) parts = [{ kind: 'unsupported', reason: 'Berechnung ohne Formelteile' }];

  const complete = [...parts, ...multipliers].every((part) => part.kind !== 'unsupported');
  return { key, parts, multipliers, displayAsPercent, complete };
}

/**
 * Parse one champion's bin JSON into the canonical model.
 *
 * Unreadable spells are skipped rather than fatal: a kit with one exotic
 * ability still contributes the other four.
 */
export function parseChampionBin(raw: unknown, championId: string, patch: string): ChampionGameData {
  const records = (raw ?? {}) as Record<string, RawRecord>;
  const spells: Record<string, GameSpell> = {};
  const incomplete: string[] = [];
  const stats = statTableFor(patch);

  for (const [path, record] of Object.entries(records)) {
    const spell = record?.mSpell;
    if (!spell || typeof spell !== 'object') continue;

    const key = record.mScriptName ?? record.ObjectName ?? '';
    if (!key || isHashedKey(key)) continue;

    const dataValues: Record<string, number[]> = {};
    for (const entry of spell.DataValues ?? spell.mDataValues ?? []) {
      const name = entry?.name ?? entry?.mName;
      const values = numbers(entry?.values ?? entry?.mValues);
      if (name && values) dataValues[name] = values;
    }

    // Empty slots are kept in place: formulas address these by index.
    const effectAmounts = (spell.mEffectAmount ?? []).map((entry) => numbers(entry?.value));
    const ctx: SpellContext = { dataValues, effectAmounts, stats };

    const rawCalcs = spell.mSpellCalculations ?? {};
    const calculations: Record<string, SpellCalculation> = {};
    for (const [calcKey, rawCalc] of Object.entries(rawCalcs)) {
      if (isHashedKey(calcKey)) continue;
      const parsed = parseCalculation(calcKey, rawCalc, rawCalcs, ctx, new Set([calcKey]));
      calculations[calcKey] = parsed;
      if (!parsed.complete) incomplete.push(`${key}.${calcKey}`);
    }

    // A record with neither values nor formulas is a visual or a sub-spell.
    if (Object.keys(dataValues).length === 0 && Object.keys(calculations).length === 0) continue;

    spells[key] = {
      key,
      objectPath: record.objectPath ?? path,
      dataValues,
      effectAmounts,
      calculations,
      cooldown: numbers(spell.cooldownTime),
      cost: numbers(spell.mana),
      maxAmmo: numbers(spell.mMaxAmmo),
      ammoRechargeTime: numbers(spell.mAmmoRechargeTime),
      channelDuration: numbers(spell.mChannelDuration),
    };
  }

  return { championId, patch, spells, incomplete };
}

/* ------------------------------------------------------------------ lookups */

/** Case-insensitive spell lookup, so a casing change upstream stays survivable. */
export function findSpell(data: ChampionGameData | null, key: string): GameSpell | null {
  if (!data) return null;
  const direct = data.spells[key];
  if (direct) return direct;
  const wanted = key.toLowerCase();
  for (const spell of Object.values(data.spells)) {
    if (spell.key.toLowerCase() === wanted) return spell;
  }
  return null;
}

export function findCalculation(spell: GameSpell | null, key: string): SpellCalculation | null {
  if (!spell) return null;
  const direct = spell.calculations[key];
  if (direct) return direct;
  const wanted = key.toLowerCase();
  for (const calc of Object.values(spell.calculations)) {
    if (calc.key.toLowerCase() === wanted) return calc;
  }
  return null;
}

/** A named per-rank value, resolved for one rank. */
export function findDataValue(spell: GameSpell | null, name: string, rank: number): number | null {
  if (!spell) return null;
  return pickRank(lookupDataValue(spell.dataValues, name), rank);
}
