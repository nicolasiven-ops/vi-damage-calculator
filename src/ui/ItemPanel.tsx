/**
 * Item selection over the complete Data Dragon catalogue.
 *
 * The picker shows every purchasable Summoner's Rift item, searchable by name
 * and filterable by class. Items whose passive this calculator does not model
 * are marked, because "the stats are in, the passive is not" is a materially
 * different answer from "this item is fully accounted for".
 */

import { useMemo, useState } from 'react';
import { imageUrls } from '../data/ddragon';
import { hasModelledEffect, getItemEffect } from '../model/itemEffects';
import {
  ITEM_CLASS_LABELS,
  hasNoUsefulStats,
  type ItemClass,
  type ResolvedItem,
} from '../model/items';
import { PERCENT_STATS, STAT_KEYS, STAT_LABELS, type StatBlock } from '../model/stats';
import { Panel } from './components/Panel';

interface Props {
  items: ResolvedItem[];
  itemIds: string[];
  version: string;
  offline: boolean;
  onChange: (itemIds: string[]) => void;
}

const CLASS_FILTERS: (ItemClass | 'all')[] = ['all', 'legendary', 'boots', 'epic', 'basic', 'starter'];

export function ItemPanel({ items, itemIds, version, offline, onChange }: Props) {
  const [query, setQuery] = useState('');
  const [classFilter, setClassFilter] = useState<ItemClass | 'all'>('legendary');
  const [activeSlot, setActiveSlot] = useState<number | null>(null);

  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  const needle = query.trim().toLowerCase();
  /** A typed query searches the whole catalogue — a class filter left over from
   * an earlier browse must not silently hide the item somebody is looking up. */
  const searching = needle.length > 0;

  const filtered = useMemo(() => {
    return items.filter((item) => {
      if (!searching) {
        if (classFilter !== 'all' && item.itemClass !== classFilter) return false;
        return !(hasNoUsefulStats(item) && !hasModelledEffect(item.id));
      }
      return (
        item.name.toLowerCase().includes(needle) ||
        item.tags.some((tag) => tag.toLowerCase().includes(needle))
      );
    });
  }, [items, needle, searching, classFilter]);

  function setSlot(index: number, id: string): void {
    const next = [...itemIds];
    next[index] = id;
    onChange(next);
    setActiveSlot(null);
  }

  const totalGold = itemIds.reduce((sum, id) => sum + (byId.get(id)?.gold ?? 0), 0);

  return (
    <Panel
      index="03"
      title="Items"
      actions={
        <span className="gold-total mono" title="Gesamtkosten der Ausrüstung">
          {totalGold.toLocaleString('de-DE')} G
        </span>
      }
    >
      {offline && (
        <p className="empty-note">
          Data Dragon ist nicht erreichbar — ohne die Item-Datenbank lassen sich keine Items
          auswählen. Der Rechner arbeitet solange nur mit Vis Basiswerten.
        </p>
      )}

      <div className="item-slots">
        {itemIds.map((id, index) => {
          const item = id ? byId.get(id) : undefined;
          return (
            <button
              key={index}
              className={`item-slot${activeSlot === index ? ' active' : ''}${item ? ' filled' : ''}`}
              onClick={() => setActiveSlot(activeSlot === index ? null : index)}
              title={item ? item.name : `Slot ${index + 1} — leer`}
            >
              {item ? (
                <img src={imageUrls.item(version, item.imageFile)} alt={item.name} />
              ) : (
                <span className="item-slot-empty">+</span>
              )}
              {item && !hasModelledEffect(item.id) && item.descriptionText.length > 0 && (
                <span className="item-slot-flag" title="Passiv nicht modelliert">
                  !
                </span>
              )}
            </button>
          );
        })}
      </div>

      {itemIds.some((id) => id !== '') && (
        <button className="btn subtle" onClick={() => onChange(['', '', '', '', '', ''])}>
          Alle Items entfernen
        </button>
      )}

      {activeSlot !== null && !offline && (
        <div className="item-picker">
          <div className="item-picker-controls">
            <input
              type="search"
              placeholder={`Slot ${activeSlot + 1} — Item suchen …`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              autoFocus
            />
            <div className={`segmented wrap${searching ? ' inactive' : ''}`}>
              {CLASS_FILTERS.map((filter) => (
                <button
                  key={filter}
                  aria-pressed={!searching && classFilter === filter}
                  onClick={() => {
                    setClassFilter(filter);
                    setQuery('');
                  }}
                >
                  {filter === 'all' ? 'Alle' : ITEM_CLASS_LABELS[filter]}
                </button>
              ))}
            </div>
            {searching && (
              <span className="field-hint">
                Die Suche durchsucht alle Klassen — {filtered.length}{' '}
                {filtered.length === 1 ? 'Treffer' : 'Treffer'}.
              </span>
            )}
          </div>

          <div className="item-grid scroll-y">
            {itemIds[activeSlot] !== '' && (
              <button className="item-option clear" onClick={() => setSlot(activeSlot, '')}>
                <span className="item-option-name">Slot leeren</span>
              </button>
            )}
            {filtered.slice(0, 400).map((item) => (
              <button
                key={item.id}
                className="item-option"
                onClick={() => setSlot(activeSlot, item.id)}
                title={item.descriptionText.slice(0, 400)}
              >
                <img src={imageUrls.item(version, item.imageFile)} alt="" />
                <span className="item-option-body">
                  <span className="item-option-name">{item.name}</span>
                  <span className="item-option-stats">{summariseStats(item.stats)}</span>
                </span>
                <span className="item-option-meta">
                  <span className="mono">{item.gold.toLocaleString('de-DE')}</span>
                  {hasModelledEffect(item.id) && (
                    <span className="tag good" title="Passiv wird simuliert">
                      Passiv
                    </span>
                  )}
                </span>
              </button>
            ))}
            {filtered.length === 0 && <p className="empty-note">Keine Treffer.</p>}
          </div>
        </div>
      )}

      <SelectedItemNotes items={itemIds.map((id) => byId.get(id)).filter(Boolean) as ResolvedItem[]} />
    </Panel>
  );
}

function SelectedItemNotes({ items }: { items: ResolvedItem[] }) {
  const modelled = items.filter((item) => hasModelledEffect(item.id));
  const unmodelled = items.filter(
    (item) => !hasModelledEffect(item.id) && item.descriptionText.trim().length > 0,
  );
  const unparsed = items.filter((item) => item.unparsedStatLines.length > 0);

  if (items.length === 0) return null;

  return (
    <div className="item-notes">
      {modelled.length > 0 && (
        <div className="item-note">
          <span className="tag good">simuliert</span>
          <ul>
            {modelled.map((item) => (
              <li key={item.id}>
                <strong>{item.name}</strong> — {getItemEffect(item.id)?.note}
              </li>
            ))}
          </ul>
        </div>
      )}
      {unmodelled.length > 0 && (
        <div className="item-note">
          <span className="tag warn">nur Werte</span>
          <ul>
            {unmodelled.map((item) => (
              <li key={item.id}>
                <strong>{item.name}</strong> — Stats zählen voll, das Passiv ist nicht modelliert.
              </li>
            ))}
          </ul>
        </div>
      )}
      {unparsed.length > 0 && (
        <div className="item-note">
          <span className="tag danger">ungelesen</span>
          <ul>
            {unparsed.map((item) => (
              <li key={item.id}>
                <strong>{item.name}</strong> — nicht zuordenbare Statuszeile:{' '}
                {item.unparsedStatLines.join(', ')}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function summariseStats(stats: StatBlock): string {
  const parts: string[] = [];
  for (const key of STAT_KEYS) {
    const value = stats[key];
    if (!value) continue;
    parts.push(`${formatStat(key, value)} ${STAT_LABELS[key]}`);
  }
  return parts.join(' · ') || '—';
}

export function formatStat(key: keyof StatBlock, value: number): string {
  if (PERCENT_STATS.has(key)) return `${(value * 100).toFixed(value * 100 % 1 === 0 ? 0 : 1)} %`;
  return value.toFixed(Math.abs(value) < 10 && value % 1 !== 0 ? 1 : 0);
}
