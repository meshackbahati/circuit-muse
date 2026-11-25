export const SUBAGENT_ROLES = ['planner', 'circuit_designer', 'firmware_engineer', 'debugger', 'verifier'] as const;

export type SubAgentRole = (typeof SUBAGENT_ROLES)[number];

export const SUBAGENT_PROMPTS: Record<SubAgentRole, string> = {
  planner: 'Break the requested circuit into ordered steps. Name the board, parts, wiring, code behaviour and checks. Return a short plan only.',
  circuit_designer: 'Design the circuit: pick board and parts, give exact pin connections and component values. Return wiring instructions only.',
  firmware_engineer: 'Write firmware for the described circuit. Return the complete sketch and explain which pins it uses.',
  debugger: 'Diagnose the given circuit state, code and tool output. Name the most likely fault and the exact fix.',
  verifier: 'Check the circuit state against the request. List what is confirmed, what is missing and what to test next.',
};

export function resolveSubAgentRole(value: string): SubAgentRole {
  return (SUBAGENT_ROLES as readonly string[]).includes(value)
    ? value as SubAgentRole
    : 'planner';
}
