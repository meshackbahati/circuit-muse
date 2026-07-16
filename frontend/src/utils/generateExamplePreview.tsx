/**
 * Generate SVG Preview for Example Projects
 *
 * Creates a visual preview of the circuit layout for example cards
 */

import type { ExampleProject } from '../data/examples';

export function generateExamplePreviewSVG(example: ExampleProject): string {
  const width = 400;
  const height = 250;
  const padding = 20;

  // Calculate bounds
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;

  example.components.forEach((comp) => {
    minX = Math.min(minX, comp.x);
    maxX = Math.max(maxX, comp.x + 100); // Approximate component width
    minY = Math.min(minY, comp.y);
    maxY = Math.max(maxY, comp.y + 100); // Approximate component height
  });

  // Calculate scale to fit in preview
  const contentWidth = maxX - minX;
  const contentHeight = maxY - minY;
  const scaleX = (width - padding * 2) / contentWidth;
  const scaleY = (height - padding * 2) / contentHeight;
  const scale = Math.min(scaleX, scaleY, 1); // Don't scale up

  // Center the content
  const offsetX = (width - contentWidth * scale) / 2 - minX * scale;
  const offsetY = (height - contentHeight * scale) / 2 - minY * scale;

  const components = example.components
    .map((comp) => {
      const x = comp.x * scale + offsetX;
      const y = comp.y * scale + offsetY;

      // Simplified component representations
      if (comp.type === 'wokwi-arduino-uno') {
        return `
          <rect x="${x}" y="${y}" width="${70 * scale}" height="${60 * scale}"
                fill="#00979D" stroke="#006064" stroke-width="2" rx="3"/>
          <text x="${x + 35 * scale}" y="${y + 35 * scale}"
                fill="white" font-size="${12 * scale}" text-anchor="middle" font-family="Arial">
            Arduino
          </text>
        `;
      } else if (comp.type === 'wokwi-led') {
        const color = comp.properties.color || 'red';
        return `
          <circle cx="${x + 10 * scale}" cy="${y + 10 * scale}" r="${8 * scale}"
                  fill="${color}" stroke="#666" stroke-width="1.5" opacity="0.9"/>
          <circle cx="${x + 10 * scale}" cy="${y + 10 * scale}" r="${4 * scale}"
                  fill="${color}" opacity="0.5"/>
        `;
      } else if (comp.type === 'wokwi-rgb-led') {
        return `
          <circle cx="${x + 10 * scale}" cy="${y + 10 * scale}" r="${10 * scale}"
                  fill="url(#rgbGradient)" stroke="#666" stroke-width="1.5"/>
          <defs>
            <linearGradient id="rgbGradient">
              <stop offset="0%" stop-color="red"/>
              <stop offset="50%" stop-color="green"/>
              <stop offset="100%" stop-color="blue"/>
            </linearGradient>
          </defs>
        `;
      } else if (comp.type === 'wokwi-pushbutton') {
        return `
          <rect x="${x}" y="${y}" width="${20 * scale}" height="${20 * scale}"
                fill="#333" stroke="#666" stroke-width="1.5" rx="2"/>
          <circle cx="${x + 10 * scale}" cy="${y + 10 * scale}" r="${6 * scale}"
                  fill="#555" stroke="#888" stroke-width="1"/>
        `;
      } else {
        // Generic component
        return `
          <rect x="${x}" y="${y}" width="${30 * scale}" height="${20 * scale}"
                fill="#444" stroke="#666" stroke-width="1.5" rx="2"/>
        `;
      }
    })
    .join('');

  // Draw simplified wires
  const wires = example.wires
    .map((wire) => {
      const startComp = example.components.find((c) => c.id === wire.start.componentId);
      const endComp = example.components.find((c) => c.id === wire.end.componentId);

      if (!startComp || !endComp) return '';

      const x1 = startComp.x * scale + offsetX + 35 * scale;
      const y1 = startComp.y * scale + offsetY + 30 * scale;
      const x2 = endComp.x * scale + offsetX + 35 * scale;
      const y2 = endComp.y * scale + offsetY + 30 * scale;

      return `
        <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
              stroke="${wire.color}" stroke-width="2" opacity="0.6"/>
      `;
    })
    .join('');

  return `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" fill="#1a1a1a"/>
      <g>
        ${wires}
        ${components}
      </g>
    </svg>
  `;
}

export function generateExamplePreviewDataURL(example: ExampleProject): string {
  const svg = generateExamplePreviewSVG(example);
  const base64 = btoa(unescape(encodeURIComponent(svg)));
  return `data:image/svg+xml;base64,${base64}`;
}
