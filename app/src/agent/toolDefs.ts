import type { ToolDefinition } from './types';

export const AGENT_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'add_board',
      description: 'Add a new microcontroller board to the canvas. Supported kinds: arduino-uno, arduino-nano, arduino-mega, raspberry-pi-pico, pi-pico-w, esp32, esp32-s3, esp32-c3, attiny85, stm32-bluepill',
      parameters: {
        type: 'object',
        properties: {
          board_kind: { type: 'string', description: 'Board type identifier' },
          x: { type: 'number', description: 'X position on canvas (0-1200)' },
          y: { type: 'number', description: 'Y position on canvas (0-800)' },
        },
        required: ['board_kind'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_board',
      description: 'Remove a board and all its connected wires from the canvas',
      parameters: {
        type: 'object',
        properties: {
          board_id: { type: 'string', description: 'ID of the board to remove' },
        },
        required: ['board_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_component',
      description: 'Add an electronic component to the canvas',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'Component type (e.g. wokwi-led, wokwi-resistor, wokwi-pushbutton, wokwi-buzzer, wokwi-servo, dht22, hc-sr04, mpu6050, bmp280, ssd1306)' },
          x: { type: 'number', description: 'X position on canvas' },
          y: { type: 'number', description: 'Y position on canvas' },
          rotation: { type: 'number', description: 'Rotation in degrees (0, 90, 180, 270)' },
          attrs: { type: 'object', description: 'Component-specific attributes' },
        },
        required: ['type', 'x', 'y'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'wire_components',
      description: 'Connect two component pins with a wire',
      parameters: {
        type: 'object',
        properties: {
          from_part: { type: 'string', description: 'Source component/board ID' },
          from_pin: { type: 'string', description: 'Source pin name' },
          to_part: { type: 'string', description: 'Destination component/board ID' },
          to_pin: { type: 'string', description: 'Destination pin name' },
          color: { type: 'string', description: 'Wire color' },
        },
        required: ['from_part', 'from_pin', 'to_part', 'to_pin'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'compile_code',
      description: 'Compile the current code for a specific board',
      parameters: {
        type: 'object',
        properties: {
          board_id: { type: 'string', description: 'Board to compile for' },
        },
        required: ['board_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_simulation',
      description: 'Start the simulation for all boards',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_circuit_state',
      description: 'Get the current state of the canvas: boards, components, wires',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_compile_output',
      description: 'Get the latest compilation logs and errors',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_code',
      description: 'Update the source code for a board',
      parameters: {
        type: 'object',
        properties: {
          board_id: { type: 'string', description: 'Board ID' },
          filename: { type: 'string', description: 'File to update' },
          content: { type: 'string', description: 'New file content' },
        },
        required: ['board_id', 'filename', 'content'],
      },
    },
  },
];
