import { ReactNode } from 'react';

type Props = {
  children: ReactNode;
  className?: string;
  direction?: 'column' | 'row';
};

function FieldGroup({ children, className = '', direction = 'column' }: Props) {
  return (
    <div className={`ds-field-group ds-field-group--${direction} ${className}`.trim()}>
      {children}
    </div>
  );
}

export default FieldGroup;
