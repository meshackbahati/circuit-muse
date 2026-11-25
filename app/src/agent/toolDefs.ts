import type { ToolDefinition } from './types';

export const AGENT_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'get_circuit_state',
      description: 'Inspect the current canvas: boards with compiled status, components with properties, and wires with exact pin names. Call this before changing an existing circuit.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_available_boards',
      description: 'List the board kinds that can be added to the canvas. Use an exact kind from this list with add_board.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_available_components',
      description: 'List valid component type ids, their names, pin names and default attributes. Pass the returned type value exactly to add_component.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_pin_names',
      description: 'Get exact pin names and signals exposed by a board or component already on the canvas. Required before wiring parts whose pin names are uncertain.',
      parameters: {
        type: 'object',
        properties: { part_id: { type: 'string', description: 'Board or component id from get_circuit_state' } },
        required: ['part_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_board',
      description: 'Add a microcontroller board to the canvas. Board kind must come from list_available_boards.',
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
      description: 'Remove a board and all wires attached to it.',
      parameters: {
        type: 'object',
        properties: { board_id: { type: 'string', description: 'ID of the board to remove' } },
        required: ['board_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_component',
      description: 'Add an electronic component to the canvas. Use a type id returned by list_available_components; wokwi- aliases are accepted and translated.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'Component type identifier' },
          x: { type: 'number', description: 'X position on canvas' },
          y: { type: 'number', description: 'Y position on canvas' },
          rotation: { type: 'number', description: 'Rotation in degrees (0, 90, 180, 270)' },
          attrs: { type: 'object', description: 'Component-specific attributes, for example {"value":"220"}' },
        },
        required: ['type', 'x', 'y'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_component',
      description: 'Remove a component and its wires when a wiring or layout mistake must be corrected.',
      parameters: {
        type: 'object',
        properties: { component_id: { type: 'string', description: 'Component id from get_circuit_state' } },
        required: ['component_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_component_property',
      description: 'Set one property on a component, for example a resistor value or LED color, to correct a design.',
      parameters: {
        type: 'object',
        properties: {
          component_id: { type: 'string', description: 'Component id from get_circuit_state' },
          name: { type: 'string', description: 'Property name, for example value or color' },
          value: { description: 'New property value' },
        },
        required: ['component_id', 'name', 'value'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'wire_components',
      description: 'Connect two pins with a wire. Use ids from get_circuit_state and exact pin names from get_pin_names or list_available_components. Add waypoints when a direct path would cross the face of a display or another part.',
      parameters: {
        type: 'object',
        properties: {
          from_part: { type: 'string', description: 'Source component/board ID' },
          from_pin: { type: 'string', description: 'Source pin name' },
          to_part: { type: 'string', description: 'Destination component/board ID' },
          to_pin: { type: 'string', description: 'Destination pin name' },
          color: { type: 'string', description: 'Wire color' },
          waypoints: {
            type: 'array',
            description: 'Optional canvas points the wire passes through, in order, to route around a part.',
            items: {
              type: 'object',
              properties: {
                x: { type: 'number' },
                y: { type: 'number' },
              },
              required: ['x', 'y'],
            },
          },
        },
        required: ['from_part', 'from_pin', 'to_part', 'to_pin'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_wire',
      description: 'Remove a wire when a connection is wrong.',
      parameters: {
        type: 'object',
        properties: { wire_id: { type: 'string', description: 'Wire id from get_circuit_state' } },
        required: ['wire_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_wiring',
      description: 'Report the canvas wiring: every wire with endpoints, components with no wires on them, and any wires that point at missing parts. Use this after creating components or wires to make sure nothing is left dangling.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_code',
      description: 'Read the source files of a board. Omit filename to list every file with its content. Omit board_id for the active board.',
      parameters: {
        type: 'object',
        properties: {
          board_id: { type: 'string', description: 'Optional board id; defaults to the active board' },
          filename: { type: 'string', description: 'Optional file name such as sketch.ino' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_code',
      description: 'Create or overwrite a source file for a board. Use this to write sketches and headers, and to fix compiler errors reported by compile_code.',
      parameters: {
        type: 'object',
        properties: {
          board_id: { type: 'string', description: 'Optional board id; defaults to the active board' },
          filename: { type: 'string', description: 'File name to create or overwrite, for example sketch.ino' },
          content: { type: 'string', description: 'Complete new file content' },
        },
        required: ['filename', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'compile_code',
      description: 'Compile a board sketch and load the resulting firmware. Returns compiler diagnostics on failure. Always compile after writing or changing code.',
      parameters: {
        type: 'object',
        properties: { board_id: { type: 'string', description: 'Optional board id; defaults to the active board' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'compile_all_code',
      description: 'Compile every board on the canvas once and return a combined result. Use this for multi-board circuits instead of calling compile_code per board.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_compile_output',
      description: 'Read the compilation console, including warnings and errors from every compile performed in this session.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'verify_circuit',
      description: 'Run an electrical safety check on the current canvas. Reports shorts, LED overcurrent, resistor overpower and unpowered indicators before a run.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_simulation',
      description: 'Run a board that has compiled firmware. Compile first. Omit board_id to run the active board.',
      parameters: {
        type: 'object',
        properties: { board_id: { type: 'string', description: 'Optional board id; defaults to the active board' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'stop_simulation',
      description: 'Stop a running board. Omit board_id to stop the active board.',
      parameters: {
        type: 'object',
        properties: { board_id: { type: 'string', description: 'Optional board id; defaults to the active board' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reset_simulation',
      description: 'Reset a board and clear its serial output so a fresh run can be compared against the previous one.',
      parameters: {
        type: 'object',
        properties: { board_id: { type: 'string', description: 'Optional board id; defaults to the active board' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_simulation_output',
      description: 'Read serial output, running state, compile state and crash information for every board. Use this after run_simulation to check whether the sketch behaved as intended.',
      parameters: {
        type: 'object',
        properties: { board_id: { type: 'string', description: 'Optional board id; returns all boards when omitted' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_environment',
      description: 'Check the backend, compiler toolchains, QEMU runtimes, installed libraries, and what a selected board still needs. Call this before installing anything or when a compile fails because a core or library is missing.',
      parameters: {
        type: 'object',
        properties: { board_id: { type: 'string', description: 'Optional board id to include board-specific recommendations' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'install_firmware',
      description: 'Install a missing runtime or firmware. Use component values qemu-esp32, qemu-stm32, arduino-core, micropython, or all-for-board. Obtain the value from check_environment.',
      parameters: {
        type: 'object',
        properties: {
          component: { type: 'string', description: 'One of qemu-esp32, qemu-stm32, arduino-core, micropython, all-for-board' },
          board_id: { type: 'string', description: 'Optional board id used to derive the core and firmware variant' },
          core: { type: 'string', description: 'Optional Arduino core identifier, for example arduino:avr' },
        },
        required: ['component'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_board_language',
      description: 'Switch a board between Arduino (C++) and MicroPython firmware workflows. Install the corresponding firmware first.',
      parameters: {
        type: 'object',
        properties: {
          board_id: { type: 'string', description: 'Optional board id; defaults to the active board' },
          mode: { type: 'string', description: 'Either arduino or micropython' },
        },
        required: ['mode'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_libraries',
      description: 'Search the Arduino library index for a library by name before installing it.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Library name or keyword' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'install_library',
      description: 'Install an Arduino library required by a sketch. Search first when the exact name is uncertain.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Exact library name' },
          version: { type: 'string', description: 'Optional version; latest is used when omitted' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_installed_libraries',
      description: 'List libraries already installed on the compiler backend so the agent does not reinstall them.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_uploaded_files',
      description: 'List files the user attached to the chat, with id, name, type, size and extracted text length.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_uploaded_file',
      description: 'Read an attached file. Omit name to get all files. Set include_data for image base64.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Optional file name' },
          include_data: { type: 'boolean', description: 'Include image data URL when true' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delegate_to_subagent',
      description: 'Hand a focused part of a large circuit to a sub-agent. Roles: planner, circuit_designer, firmware_engineer, debugger, verifier. Returns written analysis, not canvas changes.',
      parameters: {
        type: 'object',
        properties: {
          role: { type: 'string', description: 'One of planner, circuit_designer, firmware_engineer, debugger, verifier' },
          task: { type: 'string', description: 'What this sub-agent should work out' },
        },
        required: ['role', 'task'],
      },
    },
  },
];
