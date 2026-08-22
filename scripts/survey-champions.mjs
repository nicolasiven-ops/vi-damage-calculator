/**
 * Evidence for each declaration: Riot's tooltip next to Riot's formula.
 *
 * The damage *type* is not in the bin in any form this app reads, but it is in the
 * Data Dragon tooltip as words — "physical damage", "magic damage". So the type is
 * taken from there rather than from memory, and printed next to the candidate
 * calculations so the choice of key can be checked against the numbers the tooltip
 * quotes.
 */
const CHAMPS = {
  Graves: 'graves',
  LeeSin: 'leesin',
  Nocturne: 'nocturne',
  JarvanIV: 'jarvaniv',
  Sylas: 'sylas',
  MonkeyKing: 'monkeyking',
  Talon: 'talon',
  Shyvana: 'shyvana',
  Hecarim: 'hecarim',
  Briar: 'briar',
};

const VERSION = '16.16.1';
const SLOTS = ['Q', 'W', 'E', 'R'];

function clean(text) {
  return String(text ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Which damage words a tooltip uses, in the order they appear. */
function typesIn(text) {
  const found = [];
  const lower = text.toLowerCase();
  for (const word of ['physical damage', 'magic damage', 'true damage']) {
    const at = lower.indexOf(word);
    if (at >= 0) found.push([at, word.split(' ')[0]]);
  }
  return found.sort((a, b) => a[0] - b[0]).map((entry) => entry[1]);
}

/** A calculation's shape: the flat part per rank and the ratios it reads. */
function shapeOf(calc) {
  const parts = calc?.mFormulaParts ?? calc?.mFormula?.mFormulaParts ?? [];
  const bits = [];
  for (const part of parts) {
    const kind = part.__type ?? '?';
    if (kind.includes('NumberCalculationPart')) {
      bits.push(`flat ${part.mNumber}`);
    } else if (kind.includes('NamedDataValue')) {
      bits.push(`value ${part.mDataValue}`);
    } else if (kind.includes('StatBySubPart') || kind.includes('StatByCoefficient')) {
      bits.push(`stat ${part.mStat ?? 0}×${part.mRatio ?? part.mCoefficient ?? '?'}`);
    } else if (kind.includes('ProductOf')) {
      bits.push('product');
    } else if (kind.includes('SumOf')) {
      bits.push('sum');
    } else {
      bits.push(kind.replace(/^\{|\}$/g, '').slice(0, 22));
    }
  }
  return bits.join(' + ') || '(unreadable shape)';
}

for (const [ddragonId, binId] of Object.entries(CHAMPS)) {
  const [bin, dd] = await Promise.all([
    fetch(`https://raw.communitydragon.org/latest/game/data/characters/${binId}/${binId}.bin.json`).then((r) => r.json()),
    fetch(`https://ddragon.leagueoflegends.com/cdn/${VERSION}/data/en_US/champion/${ddragonId}.json`).then((r) => r.json()),
  ]);

  const spells = dd.data[ddragonId].spells;
  console.log(`\n########## ${ddragonId}`);

  SLOTS.forEach((slot, index) => {
    const spell = spells[index];
    const tooltip = clean(spell.tooltip);
    console.log(`\n  ${slot} ${spell.name} [${spell.id}]  types: ${typesIn(tooltip).join(', ') || 'none named'}`);
    console.log(`    tooltip: ${tooltip.slice(0, 190)}`);
  });

  // Every calculation this champion has, with its shape.
  console.log('\n  calculations:');
  for (const [path, value] of Object.entries(bin)) {
    const calcs = value?.mSpell?.mSpellCalculations;
    if (!calcs) continue;
    const name = path.split('/').pop();
    for (const [key, calc] of Object.entries(calcs)) {
      console.log(`    ${name}.${key}: ${shapeOf(calc)}`);
    }
  }
}
