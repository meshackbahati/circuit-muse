/**
 * avr_runner.js
 * -------------
 * Node.js ATmega328P (Arduino Uno) emulator using avr8js.
 *
 * Loads a compiled Intel HEX firmware file and emulates the CPU at
 * 16 MHz.  The USART (Serial) peripheral is bridged to a TCP socket
 * so the Python broker can connect and exchange bytes.
 *
 * Usage:
 *   node avr_runner.js <hex_file> [broker_host] [broker_port]
 *
 * The script acts as a TCP CLIENT.  It connects (with retries) to the
 * Python broker which acts as the server for the Arduino side.
 *
 * Data flow:
 *   Pi --> broker:5556 --> avr_runner --> usart.writeByte()  --> Arduino RX
 *   Arduino TX --> usart.onByteTransmit --> broker:5556 --> Pi
 */

'use strict';

const fs   = require('fs');
const net  = require('net');
const path = require('path');

// ── Load avr8js from local third-party ────────────────────────────────────────
const AVR8JS_CJS = path.resolve(
  __dirname, '..', '..', 'third-party', 'avr8js', 'dist', 'cjs', 'index.js'
);

let avr8js;
try {
  avr8js = require(AVR8JS_CJS);
} catch (e) {
  process.stderr.write(`[avr_runner] FATAL: cannot load avr8js from:\n  ${AVR8JS_CJS}\n  ${e.message}\n`);
  process.exit(1);
}

const {
  CPU,
  avrInstruction,
  AVRUSART, usart0Config,
  AVRTimer,  timer0Config, timer1Config, timer2Config,
} = avr8js;

// ── CLI arguments ─────────────────────────────────────────────────────────────
const [,, hexFile, brokerHost = '127.0.0.1', brokerPort = '5556'] = process.argv;

if (!hexFile) {
  process.stderr.write('Usage: node avr_runner.js <hex_file> [broker_host] [broker_port]\n');
  process.exit(1);
}

if (!fs.existsSync(hexFile)) {
  process.stderr.write(`[avr_runner] ERROR: hex file not found: ${hexFile}\n`);
  process.exit(1);
}

// ── Intel HEX parser ──────────────────────────────────────────────────────────
function parseIntelHex(content) {
  // ATmega328P has 32 KB flash → 0x8000 bytes
  const flash = new Uint8Array(0x8000);

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith(':') || line.length < 11) continue;

    const bytes      = Buffer.from(line.slice(1), 'hex');
    const byteCount  = bytes[0];
    const addr       = (bytes[1] << 8) | bytes[2];
    const recordType = bytes[3];

    if (recordType === 0x00) {          // Data record
      for (let i = 0; i < byteCount; i++) {
        if (addr + i < flash.length) {
          flash[addr + i] = bytes[4 + i];
        }
      }
    }
    // recordType 0x01 = EOF — nothing to do
  }

  // AVR instructions are 16-bit little-endian words
  return new Uint16Array(flash.buffer);
}

// ── Build the CPU ─────────────────────────────────────────────────────────────
const CLOCK_HZ = 16_000_000;

const hexContent = fs.readFileSync(hexFile, 'utf8');
const program    = parseIntelHex(hexContent);
const cpu        = new CPU(program);

// Timers are needed for delay() / millis() inside the Arduino sketch
const timers = [
  new AVRTimer(cpu, timer0Config),
  new AVRTimer(cpu, timer1Config),
  new AVRTimer(cpu, timer2Config),
];

const usart = new AVRUSART(cpu, usart0Config, CLOCK_HZ);

// ── TCP bridge state ───────────────────────────────────────────────────────────
let socket     = null;
let txBacklog  = [];           // bytes queued before TCP connects

// Pi → Arduino: software RX queue.
// avr8js USART has no internal RX buffer — writeByte() drops the byte if
// rxBusy is true.  onRxComplete fires only in the baud-rate-timed path
// (immediate=false), NOT when the Arduino reads UDR.  So we drain this
// queue in runBatch() after each instruction batch when rxBusy is false.
let rxQueue = [];

function tryInjectRx() {
  if (rxQueue.length === 0) return;
  const byte = rxQueue.shift();
  // writeByte(byte, true) returns false on failure, undefined on success (no return stmt)
  if (usart.writeByte(byte, true) === false) {
    // USART RX disabled — put it back; runBatch will retry next tick
    rxQueue.unshift(byte);
  }
}

// Arduino → Pi: forward transmitted bytes (line-buffered logging)
let _avrTxLineBuf = '';
usart.onByteTransmit = (byte) => {
  const ch = String.fromCharCode(byte);
  if (ch === '\n') {
    if (_avrTxLineBuf.trim()) process.stdout.write(`[AVR->Pi] ${_avrTxLineBuf}\n`);
    _avrTxLineBuf = '';
  } else {
    _avrTxLineBuf += ch;
  }

  if (socket && !socket.destroyed) {
    socket.write(Buffer.from([byte]));
  } else {
    txBacklog.push(byte);       // buffer until connected
  }
};

// ── Simulation loop ───────────────────────────────────────────────────────────
// Run ~160 000 instructions per Node.js event-loop tick ≈ 10 ms simulated time.
// setImmediate() yields after each batch so I/O callbacks can fire.
const BATCH = 160_000;

function runBatch() {
  for (let i = 0; i < BATCH; i++) {
    avrInstruction(cpu);
    cpu.tick();
  }
  // Drain RX queue: inject next byte if Arduino has already read the previous one
  if (rxQueue.length > 0 && !usart.rxBusy) {
    tryInjectRx();
  }
  setImmediate(runBatch);
}

// ── TCP connection to broker ──────────────────────────────────────────────────
let retryCount = 0;
const MAX_RETRIES = 40;    // 40 × 500 ms = 20 s

function connectToBroker() {
  if (retryCount >= MAX_RETRIES) {
    process.stderr.write('[avr_runner] ERROR: could not connect to broker after max retries\n');
    process.exit(1);
  }

  const s = new net.Socket();

  s.connect(parseInt(brokerPort, 10), brokerHost, () => {
    retryCount = 0;
    socket     = s;
    process.stdout.write(`[avr_runner] Connected to broker ${brokerHost}:${brokerPort}\n`);

    // Flush bytes queued before connection
    if (txBacklog.length > 0) {
      s.write(Buffer.from(txBacklog));
      txBacklog = [];
    }
  });

  // Pi → Arduino: feed received bytes into USART RX via queue (line-buffered log)
  let _piRxLineBuf = '';
  s.on('data', (chunk) => {
    for (const byte of chunk) {
      const ch = String.fromCharCode(byte);
      if (ch === '\n') {
        if (_piRxLineBuf.trim()) process.stdout.write(`[Pi->AVR] ${_piRxLineBuf}\n`);
        _piRxLineBuf = '';
      } else {
        _piRxLineBuf += ch;
      }
      rxQueue.push(byte);
    }
    // Inject first byte immediately if USART is free
    if (rxQueue.length > 0 && !usart.rxBusy) {
      tryInjectRx();
    }
  });

  s.on('close', () => {
    process.stdout.write('[avr_runner] Broker connection closed\n');
    socket = null;
  });

  s.on('error', (err) => {
    if (err.code === 'ECONNREFUSED') {
      retryCount++;
      process.stdout.write(`[avr_runner] Broker not ready, retry ${retryCount}/${MAX_RETRIES} ...\n`);
      setTimeout(connectToBroker, 500);
    } else {
      process.stderr.write(`[avr_runner] Socket error: ${err.message}\n`);
    }
  });
}

// ── Start ─────────────────────────────────────────────────────────────────────
process.stdout.write(`[avr_runner] Loaded: ${path.basename(hexFile)}\n`);
process.stdout.write(`[avr_runner] ATmega328P @ ${CLOCK_HZ / 1e6} MHz — simulation starting\n`);

connectToBroker();
runBatch();
