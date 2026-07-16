export interface ComponentTemplate {
  type: 'led' | 'resistor' | 'pushbutton' | 'potentiometer';
  label: string;
  icon: string;
  defaultProperties: {
    color?: string;
    value?: number;
    pin?: number;
  };
}

export type ComponentType = 'led' | 'resistor' | 'pushbutton' | 'potentiometer';

export interface ComponentProperties {
  color?: string;
  value?: number;
  pin?: number;
  state?: boolean;
}

export interface Component {
  id: string;
  type: ComponentType;
  x: number;
  y: number;
  properties: ComponentProperties;
}
