/**
 * AVRHarness — Velxio-faithful avr8js wrapper for ATmega328P (Arduino Uno/Nano).
 *
 * Mirrors frontend/src/simulation/AVRSimulator.ts so chip integration tests
 * exercise the same code paths Velxio uses in production.
 *
 * Exposes: load(hex), runCycles(n), getPin(pin), onPinChange(pin, cb),
 *          setAnalogVoltage(ch, volts), getPWMDuty(pin), pinManager, twi.
 */
import {
  CPU, AVRIOPort, AVRTimer, AVRADC, AVRUSART, AVRTWI,
  portBConfig, portCConfig, portDConfig,
  timer0Config, timer1Config, timer2Config,
  adcConfig, usart0Config, twiConfig,
  avrInstruction,
} from 'avr8js';
import { parseIntelHex, bytesToProgramWords } from './intelHex.js';
import { PinManager } from './PinManager.js';

const PWM_PINS = [
  { ocrAddr: 0x47, pin: 6 },
  { ocrAddr: 0x48, pin: 5 },
  { ocrAddr: 0x88, pin: 9 },
  { ocrAddr: 0x8A, pin: 10 },
  { ocrAddr: 0xB3, pin: 11 },
  { ocrAddr: 0xB4, pin: 3 },
];

export class AVRHarness {
  constructor() {
    this.cpu = null;
    this.ports = { B: null, C: null, D: null };
    this.adc = null;
    this.usart = null;
    this.twi = null;
    this.timers = [];
    this.serialOut = [];
    this.pinManager = new PinManager();
    this.portValues = { B: 0, C: 0, D: 0 };
  }

  load(hexText) {
    const bytes = parseIntelHex(hexText);
    const program = bytesToProgramWords(bytes);
    this._bindCpu(program);
  }

  loadProgram(words) {
    const program = new Uint16Array(0x8000 / 2);
    program.set(words);
    this._bindCpu(program);
  }

  _bindCpu(program) {
    this.cpu = new CPU(program, 8192);
    this.ports.B = new AVRIOPort(this.cpu, portBConfig);
    this.ports.C = new AVRIOPort(this.cpu, portCConfig);
    this.ports.D = new AVRIOPort(this.cpu, portDConfig);
    this.adc = new AVRADC(this.cpu, adcConfig);
    this.twi = new AVRTWI(this.cpu, twiConfig, 16_000_000);
    this.usart = new AVRUSART(this.cpu, usart0Config, 16_000_000);
    this.usart.onByteTransmit = (v) => this.serialOut.push(String.fromCharCode(v));
    this.timers = [
      new AVRTimer(this.cpu, timer0Config),
      new AVRTimer(this.cpu, timer1Config),
      new AVRTimer(this.cpu, timer2Config),
    ];

    for (const name of ['B', 'C', 'D']) {
      const port = this.ports[name];
      port.addListener((value) => {
        const old = this.portValues[name];
        this.portValues[name] = value;
        this.pinManager.updatePort(`PORT${name}`, value, old);
      });
    }
  }

  runCycles(n) {
    const end = this.cpu.cycles + n;
    while (this.cpu.cycles < end) {
      avrInstruction(this.cpu);
      this.cpu.tick();
    }
  }

  getPin(pin) {
    // Bypass PinManager and read the AVRIOPort directly so we can see
    // both input and output states (the simulator may drive pins both ways).
    if (pin >= 0 && pin <= 7) {
      return (this.ports.D.pinState(pin) === 3 || this.ports.D.pinState(pin) === 1) ? 1 : 0;
    }
    if (pin >= 8 && pin <= 13) {
      const bit = pin - 8;
      return (this.ports.B.pinState(bit) === 3 || this.ports.B.pinState(bit) === 1) ? 1 : 0;
    }
    if (pin >= 14 && pin <= 19) {
      const bit = pin - 14;
      return (this.ports.C.pinState(bit) === 3 || this.ports.C.pinState(bit) === 1) ? 1 : 0;
    }
    return 0;
  }

  onPinChange(pin, cb) {
    return this.pinManager.onPinChange(pin, (_p, state) => cb(state ? 1 : 0));
  }

  setAnalogVoltage(channel, volts) {
    if (this.adc) this.adc.channelValues[channel] = Math.max(0, Math.min(5, volts));
  }

  getPWMDuty(pin) {
    const e = PWM_PINS.find((p) => p.pin === pin);
    if (!e) return null;
    return this.cpu.data[e.ocrAddr] / 255;
  }

  getSerialOutput() {
    return this.serialOut.join('');
  }
}
