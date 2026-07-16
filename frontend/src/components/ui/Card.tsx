import type { HTMLAttributes, ReactNode } from 'react';
import './Card.css';

type Variant = 'default' | 'elevated' | 'outlined';

interface Props extends HTMLAttributes<HTMLDivElement> {
  variant?: Variant;
  header?: ReactNode;
  footer?: ReactNode;
  padding?: 'sm' | 'md' | 'lg';
}

export function Card({
  variant = 'default',
  header,
  footer,
  padding = 'md',
  className,
  children,
  ...rest
}: Props) {
  const classes = [
    'ui-card',
    `ui-card--${variant}`,
    `ui-card--p-${padding}`,
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes} {...rest}>
      {header ? <div className="ui-card__header">{header}</div> : null}
      <div className="ui-card__body">{children}</div>
      {footer ? <div className="ui-card__footer">{footer}</div> : null}
    </div>
  );
}
