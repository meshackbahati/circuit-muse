import './ComponentPalette.css';
import type { ComponentTemplate } from '../../types/components';

export type { ComponentTemplate };

const COMPONENT_TEMPLATES: ComponentTemplate[] = [
  {
    type: 'led',
    label: 'LED',
    icon: 'L',
    defaultProperties: { color: 'red' },
  },
  {
    type: 'resistor',
    label: 'Resistor',
    icon: 'R',
    defaultProperties: { value: 220 },
  },
  {
    type: 'pushbutton',
    label: 'Button',
    icon: 'B',
    defaultProperties: { color: 'red' },
  },
  {
    type: 'potentiometer',
    label: 'Potentiometer',
    icon: 'P',
    defaultProperties: { value: 50 },
  },
];

interface ComponentPaletteProps {
  onDragStart: (template: ComponentTemplate) => void;
}

export const ComponentPalette = ({ onDragStart }: ComponentPaletteProps) => {
  const handleDragStart = (template: ComponentTemplate) => (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('componentType', template.type);
    onDragStart(template);
  };

  return (
    <div className="component-palette">
      <div className="palette-header">
        <h3>Components</h3>
        <span className="palette-hint">Drag to canvas</span>
      </div>
      <div className="palette-items">
        {COMPONENT_TEMPLATES.map((template) => (
          <div
            key={template.type}
            className="palette-item"
            draggable
            onDragStart={handleDragStart(template)}
          >
            <span className="palette-icon">{template.icon}</span>
            <span className="palette-label">{template.label}</span>
          </div>
        ))}
      </div>
      <div className="palette-help">
        <p>Drag components to the canvas</p>
        <p>Click a component to assign pin</p>
        <p>Press Delete to remove selected</p>
      </div>
    </div>
  );
};
