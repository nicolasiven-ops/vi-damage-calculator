// Writes the Summoner's Rift item roster of one patch into a test fixture.
// Run: node gen-items.mjs <patch> <outFile>
import { writeFileSync } from 'node:fs';

const patch = process.argv[2] ?? '16.16.1';
const out = process.argv[3];
if (!out) throw new Error('no output path given');

const res = await fetch(`https://ddragon.leagueoflegends.com/cdn/${patch}/data/en_US/item.json`);
if (!res.ok) throw new Error(`item.json ${res.status}`);
const json = await res.json();

const rows = Object.entries(json.data)
  .filter(
    ([id, item]) =>
      item.maps?.['11'] &&
      item.inStore !== false &&
      item.gold?.purchasable &&
      Number(id) < 220000,
  )
  .map(([id, item]) => ({ id, name: item.name, gold: item.gold.total }))
  .sort((a, b) => Number(a.id) - Number(b.id));

const body = rows
  .map((row) => `  { id: '${row.id}', name: ${JSON.stringify(row.name)}, gold: ${row.gold} },`)
  .join('\n');

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
 * Regenerate with scripts/gen-items.mjs when the patch moves.
 */

export interface ShopItem {
  id: string;
  name: string;
  gold: number;
}

export const SR_ITEMS: ShopItem[] = [
${body}
];

export const SR_ITEMS_PATCH = '${patch}';
`,
  'utf8',
);

console.log(`wrote ${rows.length} items for ${patch}`);
