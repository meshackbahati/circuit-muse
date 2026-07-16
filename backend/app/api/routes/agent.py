"""Agent routes — thin wrappers for structured agent consumption."""

from fastapi import APIRouter

router = APIRouter()


@router.get("/tools")
async def get_tool_definitions():
    """Return tool definitions matching frontend/toolDefs.ts."""
    return {
        "tools": [
            {
                "type": "function",
                "function": {
                    "name": "add_board",
                    "description": "Add a new microcontroller board to the canvas",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "board_kind": {"type": "string", "description": "Board type"},
                            "x": {"type": "number", "description": "X position"},
                            "y": {"type": "number", "description": "Y position"},
                        },
                        "required": ["board_kind"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "remove_board",
                    "description": "Remove a board from the canvas",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "board_id": {"type": "string", "description": "Board ID"},
                        },
                        "required": ["board_id"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "add_component",
                    "description": "Add an electronic component to the canvas",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "type": {"type": "string", "description": "Component type"},
                            "x": {"type": "number", "description": "X position"},
                            "y": {"type": "number", "description": "Y position"},
                            "rotation": {"type": "number", "description": "Rotation degrees"},
                            "attrs": {"type": "object", "description": "Component attributes"},
                        },
                        "required": ["type", "x", "y"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "wire_components",
                    "description": "Connect two component pins with a wire",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "from_part": {"type": "string"},
                            "from_pin": {"type": "string"},
                            "to_part": {"type": "string"},
                            "to_pin": {"type": "string"},
                            "color": {"type": "string"},
                        },
                        "required": ["from_part", "from_pin", "to_part", "to_pin"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "compile_code",
                    "description": "Compile code for a board",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "board_id": {"type": "string"},
                        },
                        "required": ["board_id"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "run_simulation",
                    "description": "Start simulation for all boards",
                    "parameters": {"type": "object", "properties": {}},
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "get_circuit_state",
                    "description": "Get current canvas state",
                    "parameters": {"type": "object", "properties": {}},
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "get_compile_output",
                    "description": "Get latest compilation logs",
                    "parameters": {"type": "object", "properties": {}},
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "update_code",
                    "description": "Update source code for a board",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "board_id": {"type": "string"},
                            "filename": {"type": "string"},
                            "content": {"type": "string"},
                        },
                        "required": ["board_id", "filename", "content"],
                    },
                },
            },
        ]
    }
