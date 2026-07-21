import { HTMLAttributes, ReactNode } from 'react';

type Props = {
  padding?: 'sm' | 'md' | 'lg';
  children: ReactNode;
} & HTMLAttributes<HTMLDivElement>;

function Card({ padding = 'md', className = '', children, ...rest }: Props) {
  return (
    <div {...rest} className={`ds-card ds-card--padding-${padding} ${className}`.trim()}>
      {children}
    </div>
  );
}

export default Card;
