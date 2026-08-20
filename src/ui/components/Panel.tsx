import type { ReactNode } from 'react';

interface Props {
  title: string;
  /** Small numeral shown before the title, like a section marker. */
  index?: string;
  actions?: ReactNode;
  children: ReactNode;
  tight?: boolean;
  className?: string;
}

export function Panel({ title, index, actions, children, tight, className }: Props) {
  return (
    <section className={`panel${className ? ` ${className}` : ''}`}>
      <header className="panel-header">
        <h2 className="panel-title">
          {index && <span className="panel-title-index">{index}</span>}
          {title}
        </h2>
        {actions}
      </header>
      <div className={`panel-body${tight ? ' tight' : ''}`}>{children}</div>
    </section>
  );
}
