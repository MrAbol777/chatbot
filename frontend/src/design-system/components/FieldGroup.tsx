import { CSSProperties, ReactNode } from 'react';

type Props = {
  children: ReactNode;
  className?: string;
  direction?: 'column' | 'row';
  style?: CSSProperties;
};

function FieldGroup({ children, className = '', direction = 'column', style }: Props) {
  return (
    <div className={`ds-field-group ds-field-group--${direction} ${className}`.trim()} style={style}>
      {children}
    </div>
  );
}

export default FieldGroup;
