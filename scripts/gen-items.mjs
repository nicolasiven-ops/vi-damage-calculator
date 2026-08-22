// Writes the Summoner's Rift item roster of one patch into a test fixture.
// Run: node gen-items.mjs <patch> <outFile>
import { writeFileSync } from 'node:fs';

const patch = process.argv[2] ?? '16.16.1';
const out = process.argv[3];
if (!out) throw new Error('no output path given');

const res = await fetch(`https://ddragon.leagueoflegends.com/cdn/${patch}/data/en_US/item.json`);
if (!res.ok) throw new Error(`item.json ${res.status}`);
const json = await res.json();

const hasPassive = (item) => /<passive>|<active>|Passive:|Active:/i.test(item.description ?? '');

const rows = Object.entries(json.data)
  .filter(
    ([id, item]) =>
      item.maps?.['11'] &&
      item.inStore !== false &&
      item.gold?.purchasable &&
      Number(id) < 220000,
  )
  .map(([id, item]) => ({
    id,
    name: item.name,
    gold: item.gold.total,
    /*
     * What a player means by "an item": nothing builds out of it, and it costs
     * enough to be a slot rather than a stepping stone. The 1,300 g floor is
     * where Riot's own epic tier begins, and it also drops the consumables and
     * trinkets, which have passives but not the kind anyone theorycrafts.
     */
    completed: !(item.into?.length > 0) && item.gold.total >= 1300,
    hasPassive: hasPassive(item),
  }))
  .sort((a, b) => Number(a.id) - Number(b.id));

const body = rows
  .map(
    (row) =>
      `  { id: '${row.id}', name: ${JSON.stringify(row.name)}, gold: ${row.gold}` +
      `, completed: ${row.completed}, hasPassive: ${row.hasPassive} },`,
  )
  .join('\n');

const completed = rows.filter((row) => row.completed);
const modellable = completed.filter((row) => row.hasPassive);

writeFileSync(
  out,
  `/**
 * Every item a Summoner's Rift shop offers, as of patch ${patch}.
 *
 * Generated, not written: \`maps["11"]\`, \`inStore\`, \`gold.purchasable\` and an id
 * below 220000 (which excludes the Arena variants) are the filter. It exists so
 * the coverage test can fail when Riot adds an item nobody has classified —
 * silence about a new item is exactly the failure mode this project cannot
 * afford.
 *
 * Two flags carry the honest denominator for that coverage. \`completed\` marks
 * the end of a recipe chain — the ${completed.length} things a player calls "an item", as
 * opposed to the components that build into them, which are stat lines by
 * construction and need no passive modelled. \`hasPassive\` marks the ${modellable.length} of
 * those whose text actually contains a passive or an active. Counting progress
 * against all ${rows.length} shop entries reads as far worse than it is.
 *
 * Regenerate with scripts/gen-items.mjs when the patch moves.
 */

export interface ShopItem {
  id: string;
  name: string;
  gold: number;
  /** Nothing builds out of it: the end of a recipe chain. */
  completed: boolean;
  /** Its Data Dragon text contains a passive or an active. */
  hasPassive: boolean;
}

export const SR_ITEMS: ShopItem[] = [
${body}
];

export const SR_ITEMS_PATCH = '${patch}';
`,
  'utf8',
);

console.log(
  `wrote ${rows.length} items for ${patch} — ${completed.length} completed, ${modellable.length} of those with a passive`,
);
