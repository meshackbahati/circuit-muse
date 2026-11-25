/**
 * Connect SPICE-solved net voltages to digital MCU input registers.
 *
 * MCU outputs are already driven into the netlist by
 * `connectMcuEdgesToService`. The reverse direction was missing: a wire from
 * a 5 V rail, a divider or a sensor into an INPUT pin changed the SPICE node
 * voltage but never reached the CPU's PINx register, so `digitalRead()` kept
 * returning LOW. This bridge closes that loop for every board in the
 * circuit, using each board's own logic thresholds.
 */

import { useElectricalStore } from '../../store/useElectricalStore';
import { getBoardPinManager, getBoardSimulator, useSimulatorStore } from '../../store/useSimulatorStore';
import { boardPinToNumber } from '../../utils/boardPinMapping';
import { getBoardLogicFamily } from '../LogicFamilies';

function isPowerPin(pinName: string): boolean {
  const value = pinName.toUpperCase();
  return value.startsWith('GND') || value.startsWith('VCC') || value.startsWith('V+') || value === '5V' || value === '3V3';
}

export function connectDigitalInputsToMcu(): () => void {
  let lastVoltages = useElectricalStore.getState().nodeVoltages;
  let lastMap = useElectricalStore.getState().pinNetMap;

  const apply = () => {
    const electrical = useElectricalStore.getState();
    if (electrical.paused) return;
    const voltages = electrical.nodeVoltages;
    const pinNetMap = electrical.pinNetMap;
    if (voltages === lastVoltages && pinNetMap === lastMap) return;
    lastVoltages = voltages;
    lastMap = pinNetMap;

    const simState = useSimulatorStore.getState();
    for (const board of simState.boards) {
      const pm = getBoardPinManager(board.id);
      const mcu = getBoardSimulator(board.id);
      if (!pm || !mcu || typeof mcu.setPinState !== 'function') continue;
      const family = getBoardLogicFamily(board.boardKind);
      const outputPins = typeof pm.getOutputPins === 'function' ? pm.getOutputPins() : null;

      for (const [key, net] of pinNetMap) {
        const sep = key.indexOf(':');
        if (sep < 0) continue;
        const boardId = key.slice(0, sep);
        const pinName = key.slice(sep + 1);
        if (boardId !== board.id || isPowerPin(pinName)) continue;
        const pin = boardPinToNumber(board.boardKind, pinName);
        if (pin === null) continue;
        if (outputPins?.has(pin)) continue;

        const voltage = voltages[net];
        if (typeof voltage !== 'number' || !Number.isFinite(voltage)) continue;
        const state = voltage >= family.vih ? true : voltage <= family.vil ? false : pm.getPinState(pin);
        if (state === null || state === undefined) continue;
        if (pm.getPinState(pin) !== state) {
          pm.setPinState(pin, state, 'external');
          mcu.setPinState(pin, state);
        }
      }
    }
  };

  return useElectricalStore.subscribe(apply);
}
