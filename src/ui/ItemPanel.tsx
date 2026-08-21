/**
 * Item selection over the complete Data Dragon catalogue.
 *
 * The picker shows every purchasable Summoner's Rift item, searchable by name
 * and filterable by class. Items whose passive this calculator does not model
 * are marked, because "the stats are in, the passive is not" is a materially
 * different answer from "this item is fully accounted for".
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { imageUrls } from '../data/ddragon';
import { hasModelledEffect } from '../model/itemEffects';
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

  /*
   * A click anywhere else closes the picker.
   *
   * It is a large panel that opens under six small buttons, and leaving it open
   * while you work somewhere else means the next thing you click is behind it.
   * The slots themselves are inside the guarded area, so clicking a second slot
   * still switches rather than closing and reopening.
   */
  const pickerArea = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (activeSlot === null) return;
    function onPointerDown(event: MouseEvent): void {
      if (!pickerArea.current?.contains(event.target as Node)) setActiveSlot(null);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [activeSlot]);

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
    // The search is spent once it has found the thing: the next pick starts from
    // the whole catalogue rather than from the last word typed.
    setQuery('');
  }

  const totalGold = itemIds.reduce((sum, id) => sum + (byId.get(id)?.gold ?? 0), 0);

  return (
    <Panel
      title="Items"
      actions={
        <span className="gold-total mono" title="Total gold cost of the build">
          {totalGold.toLocaleString('en-US')} G
        </span>
      }
    >
      {offline && (
        <p className="empty-note">
          Data Dragon is unreachable — without the item database there are no items to pick from.
          Until it is back, the calculator runs on Vi's base stats alone.
        </p>
      )}

      <div className="item-picker-area" ref={pickerArea}>
      <div className="item-slots">
        {itemIds.map((id, index) => {
          const item = id ? byId.get(id) : undefined;
          return (
            <button
              key={index}
              className={`item-slot${activeSlot === index ? ' active' : ''}${item ? ' filled' : ''}`}
              onClick={() => setActiveSlot(activeSlot === index ? null : index)}
              title={item ? item.name : `Slot ${index + 1} — empty`}
            >
              {item ? (
                <img src={imageUrls.item(version, item.imageFile)} alt={item.name} />
              ) : (
                <span className="item-slot-empty">+</span>
              )}
              {item && !hasModelledEffect(item.id) && item.descriptionText.length > 0 && (
                <span className="item-slot-flag" title="Passive not modelled">
                  !
                </span>
              )}
            </button>
          );
        })}
      </div>

      {itemIds.some((id) => id !== '') && (
        <button className="btn subtle" onClick={() => onChange(['', '', '', '', '', ''])}>
          Clear all items
        </button>
      )}

      {activeSlot !== null && !offline && (
        <div className="item-picker">
          <div className="item-picker-controls">
            <input
              type="search"
              placeholder={`Slot ${activeSlot + 1} — search items …`}
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
                  {filter === 'all' ? 'All' : ITEM_CLASS_LABELS[filter]}
                </button>
              ))}
            </div>
            {searching && (
              <span className="field-hint">
                Search covers every class — {filtered.length}{' '}
                {filtered.length === 1 ? 'match' : 'matches'}.
              </span>
            )}
          </div>

          <div className="item-grid scroll-y">
            {itemIds[activeSlot] !== '' && (
              <button className="item-option clear" onClick={() => setSlot(activeSlot, '')}>
                <span className="item-option-name">Clear slot</span>
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
                  <span className="mono">{item.gold.toLocaleString('en-US')}</span>
                  {hasModelledEffect(item.id) && (
                    <span className="tag good" title="Passive is simulated">
                      Passive
                    </span>
                  )}
                </span>
              </button>
            ))}
            {filtered.length === 0 && <p className="empty-note">No matches.</p>}
          </div>
        </div>
      )}
      </div>

      {/*
       * No footnotes here.
       *
       * What an item does and does not do is one kind of information, and it now
       * lives in one place: the notes panel at the bottom of this sidebar. Two
       * copies of it meant reading the same sentence twice, and a panel that
       * grew with the build — which is exactly what pushed the two sidebars out
       * of step.
       */}
    </Panel>
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
  if (PERCENT_STATS.has(key)) return `${(value * 100).toFixed(value * 100 % 1 === 0 ? 0 : 1)}%`;
  return value.toFixed(Math.abs(value) < 10 && value % 1 !== 0 ? 1 : 0);
}
