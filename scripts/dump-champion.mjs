// Print a champion's published ability numbers, in the shape a champion module needs.
//
// Modelling Vi took a long afternoon of reading Riot's bin by hand: finding which
// object is which spell, which data value is the base damage, which calculation is
// the ratio, and which of the two coefficients is the one the tooltip shows. Every
// champion after her needs the same afternoon, and almost none of it is judgement —
// it is lookup. This does the lookup.
//
//   node scripts/dump-champion.mjs Vi
//   node scripts/dump-champion.mjs Ahri 16.16.1
//
// What it does NOT do is decide anything. Which calculation is "the damage", what
// happens on a recast, whether a knock-up counts as a cast — those are the parts
// that need a person, and they are exactly the parts a champion module should carry
// its reasoning for.
import process from 'node:process';

const championId = process.argv[2];
const patch = process.argv[3] ?? 'latest';
if (!championId) {
  console.error('usage: node scripts/dump-champion.mjs <ChampionId> [patch]');
  process.exit(1);
}

const CDRAGON = 'https://raw.communitydragon.org';
const DDRAGON = 'https://ddragon.leagueoflegends.com';

/** CommunityDragon lower-cases the champion folder; Data Dragon does not. */
const slug = championId.toLowerCase();

async function json(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

/** The patch Data Dragon calls current, when none was given. */
async function resolvePatch() {
  if (patch !== 'latest') return patch;
  const versions = await json(`${DDRAGON}/api/versions.json`);
  return versions[0];
}

/**
 * Riot's calculation parts, flattened into one readable line.
 *
 * The shapes are documented in src/data/bin.ts; this prints them rather than
 * interpreting them, because a printed formula can be checked against the game's
 * own tooltip and an interpreted one cannot.
 */
function describePart(part, dataValues) {
  const type = part.__type ?? '';
  if (type.includes('NamedDataValue')) {
    const values = dataValues[part.mDataValue];
    return `${part.mDataValue}${values ? ` [${values.join(', ')}]` : ''}`;
  }
  if (type.includes('Number')) return String(part.mNumber ?? 0);
  if (type.includes('StatByCoefficient')) {
    return `${part.mCoefficient ?? 1} × stat${part.mStat ?? 0}${
      part.mStatFormula ? ` (formula ${part.mStatFormula})` : ''
    }`;
  }
  if (type.includes('StatByNamedDataValue')) {
    const values = dataValues[part.mDataValue];
    return `stat${part.mStat ?? 0}${part.mStatFormula ? ` (formula ${part.mStatFormula})` : ''} × ${
      part.mDataValue
    }${values ? ` [${values.join(', ')}]` : ''}`;
  }
  if (type.includes('AbilityResourceByCoefficient')) {
    return `${part.mCoefficient ?? 1} × resource${part.mStatFormula ? ` (formula ${part.mStatFormula})` : ''}`;
  }
  if (type.includes('ByCharLevelInterpolation')) {
    return `${part.mStartValue} → ${part.mEndValue} by level`;
  }
  if (type.includes('SumOfSubParts') || type.includes('ProductOfSubParts')) {
    const joiner = type.includes('Product') ? ' × ' : ' + ';
    const parts = part.mSubparts ?? [part.mPart1, part.mPart2].filter(Boolean);
    return `(${parts.map((entry) => describePart(entry, dataValues)).join(joiner)})`;
  }
  return type || JSON.stringify(part).slice(0, 80);
}

const resolved = await resolvePatch();
const short = resolved.split('.').slice(0, 2).join('.');

console.log(`# ${championId} — patch ${resolved}\n`);

// --------------------------------------------------------------- Data Dragon
const dd = await json(`${DDRAGON}/cdn/${resolved}/data/en_US/champion/${championId}.json`);
const champion = dd.data[championId];

console.log('## Base stats (Data Dragon)');
for (const [key, value] of Object.entries(champion.stats)) {
  console.log(`  ${key.padEnd(24)} ${value}`);
}

console.log('\n## Spells (Data Dragon: names, cooldowns, costs, ranges)');
for (const [index, spell] of champion.spells.entries()) {
  const slot = ['Q', 'W', 'E', 'R'][index] ?? `S${index}`;
  console.log(`  ${slot} ${spell.name}  (id ${spell.id})`);
  console.log(`     maxrank   ${spell.maxrank}`);
  console.log(`     cooldown  ${spell.cooldownBurn}`);
  console.log(`     cost      ${spell.costBurn} ${spell.costType}`);
  console.log(`     range     ${spell.rangeBurn}`);
}
console.log(`  P ${champion.passive.name}`);

// ----------------------------------------------------------- CommunityDragon
const binUrl = `${CDRAGON}/${short}/game/data/characters/${slug}/${slug}.bin.json`;
let bin;
try {
  bin = await json(binUrl);
} catch (error) {
  console.log(`\n## Game data unavailable: ${error.message}`);
  console.log('  The Data Dragon half above is still enough to start a module.');
  process.exit(0);
}

console.log(`\n## Ability formulas (${binUrl})`);
for (const [key, record] of Object.entries(bin)) {
  const spell = record?.mSpell;
  if (!spell) continue;
  const name = key.split('/').pop();

  /*
   * Riot renamed this field: `mDataValues` up to patch 15.6, `DataValues` from
   * 15.7 on. Reading only one of them is how a dump comes back empty and looks
   * like an item with no numbers — see the same note in src/data/bin.ts.
   */
  const dataValues = {};
  for (const value of spell.mDataValues ?? spell.DataValues ?? []) {
    if (value?.mName) dataValues[value.mName] = value.mValues ?? [value.mValue ?? 0];
  }

  const calculations = Object.entries(spell.mSpellCalculations ?? spell.SpellCalculations ?? {});
  if (calculations.length === 0 && Object.keys(dataValues).length === 0) continue;

  console.log(`\n  ${name}`);
  if (spell.castTime !== undefined) console.log(`    castTime ${spell.castTime}`);
  if (spell.mCastTime !== undefined) console.log(`    mCastTime ${spell.mCastTime}`);
  for (const [valueName, values] of Object.entries(dataValues)) {
    console.log(`    ${valueName.padEnd(28)} [${values.join(', ')}]`);
  }
  for (const [calcName, calc] of calculations) {
    const parts = (calc.mFormulaParts ?? []).map((part) => describePart(part, dataValues));
    const multiplier = calc.mMultiplier
      ? ` × ${describePart(calc.mMultiplier, dataValues)}`
      : '';
    console.log(`    = ${calcName}: ${parts.join(' + ') || '(modified calculation)'}${multiplier}`);
  }
}

console.log(`
## What still needs a person
  - which calculation is the damage the tooltip shows, and which is a sibling
    (healing, shield, a monster-only value, a recast)
  - what a cast costs in time beyond mCastTime: wind-up, dash, self-lock
  - stat indices: 2 is attack damage, 12 is health, 29 is lethality, and
    mStatFormula 1 means base while 2 means bonus — see src/data/bin.ts
  - anything the bin ships as a placeholder, which has to come from the wiki and
    be marked as wiki-sourced
`);
