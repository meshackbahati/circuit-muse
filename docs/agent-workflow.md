# Agent build and verify workflow

The assistant in CircuitMuse is a tool-using engineer rather than a chat-only
advisor. This note records the stages it follows and the enforcement in the
tool layer. The ordering is enforced in code because the model does not
reliably follow prompt ordering on its own.

## Stages

1. **Inspect.** `get_circuit_state` reports boards, components, wires, and the
   wiring status. `get_pin_names`, `list_available_boards`, and
   `list_available_components` supply valid identifiers. Attached files are
   read with `list_uploaded_files` and `read_uploaded_file`.
2. **Build and wire.** `build_circuit` adds many parts and wires in one call.
   `add_component`, `wire_components`, `set_component_property`, and
   `remove_wire` handle edits. `check_wiring` audits the result.
3. **Code.** `update_code` writes a complete file into the board's group, and
   `read_code` confirms the content. Pin numbers in the sketch must match the
   wired pins.
4. **Verify electrically.** `verify_circuit` reports shorts, LED overcurrent,
   resistor overpower, and dark indicators.
5. **Compile.** `compile_code` or `compile_all_code` builds one image per
   board. `check_environment`, `install_firmware`, `install_library`, and
   `set_board_language` resolve missing dependencies first.
6. **Run and observe.** `run_simulation` starts a board or all boards and
   waits for serial output. `get_simulation_output` with `wait_ms` reads more
   output. `get_compile_output` and the console show build diagnostics.
7. **Debug.** When behaviour is wrong, the assistant forms a hypothesis from
   the evidence, changes one thing, resets, recompiles if source changed, runs
   again, and compares output. It does not report success on an empty or
   contradictory serial log.
8. **Report.** The final answer states what was built, which checks passed,
   the observed output, and any remaining limitation.

## Hard gates

`compile_code`, `compile_all_code`, and `run_simulation` read the live wiring
audit and return `blocked_by: 'wiring'` before doing any work when the audit is
incomplete. The audit requires every component to have enough distinct pins
connected for its type, every wire endpoint to resolve to a real part and pin,
and each board with external parts to share a ground. The pushbutton rule
requires one pin from each terminal of the four-pin part.

A completion gate in `app/src/agent/chatService.ts` inspects the stores before
accepting a final answer. It sends the model back to wiring, firmware,
compile, run, or serial inspection as needed. It also detects stale firmware
after `update_code`, so a source change cannot be flashed or run against the
previous image. At most three nudges are applied per phase.

Repeated inspection tools are counted per turn. Three calls to `verify_circuit`
or `compile_code` without progress stop the turn with a clear message instead
of continuing a loop.

## Stop and aborts

The chat Stop button calls `abortMessage`. The abort controller is passed into
tool execution and into compile, install, and firmware download calls. The
chat leaves its streaming state immediately, and synthetic tool results keep
the provider transcript valid. The toolbar Stop calls `stopAllBoards`, which
stops every board regardless of stale per-board flags, and clears chip drives.

## Provider reliability

Transient 503 and busy responses are retried with exponential backoff. Long
histories are compacted rather than dropped: older tool results become a short
factual summary that records wiring results, compile results, and serial
output. Large tool results are capped, and whitespace-only assistant chunks
are omitted.

Gemini uses native function call and response parts. The provider guarantees
one response part per call part, because Gemini rejects a request when those
counts differ. Gemini 3 thought signatures are read from the response part and
echoed when the call is replayed. The bundled `@google/genai` version is 3.6.1;
earlier versions did not expose thought signatures and produced HTTP 400 after
the first tool turn.

## Sub-agents

`delegate_to_subagent` accepts the roles `planner`, `circuit_designer`,
`firmware_engineer`, `debugger`, and `verifier`. A sub-agent returns a plan,
wiring design, firmware draft, diagnosis, or verification checklist. The main
assistant performs the canvas actions itself.
