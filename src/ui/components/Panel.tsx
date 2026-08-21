import type { ReactNode } from 'react';

interface Props {
  /**
   * Usually a string, but a node when the heading itself is a control — the
   * target panel picks what it is pointed at where its name would stand.
   */
  title: ReactNode;
  actions?: ReactNode;
  /**
   * Sits between the title and the actions, centred.
   *
   * For controls that belong to the panel's current state rather than to its
   * navigation — the timeline's "clear selection" is about what is selected, not
   * about which view you are in, and reads wrong tacked onto the tab row.
   */
  center?: ReactNode;
  children: ReactNode;
  tight?: boolean;
  className?: string;
}

/*
 * The panels used to carry section numbers (01–10) to orient you in one long
 * column. There is no such column any more — config panels appear one at a time
 * behind tabs — so the numbers described an order that no longer exists.
 */
export function Panel({ title, actions, center, children, tight, className }: Props) {
  return (
    <section className={`panel${className ? ` ${className}` : ''}`}>
      <header className="panel-header">
        <h2 className="panel-title">{title}</h2>
        {center && <div className="panel-center">{center}</div>}
        {actions}
      </header>
      <div className={`panel-body${tight ? ' tight' : ''}`}>{children}</div>
    </section>
  );
}
