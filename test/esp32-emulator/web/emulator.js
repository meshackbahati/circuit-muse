// Mock ESP32 Emulator using QEMU WebAssembly (placeholder)
// This is a temporary simulation until real QEMU WASM is integrated.

class ESP32Emulator {
    constructor() {
        this.running = false;
        this.interval = null;
        this.gpioState = {};
        this.serialBuffer = '';
        this.canvas = document.getElementById('simulationCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.ledX = 400;
        this.ledY = 200;
        this.ledRadius = 30;
        this.ledOn = false;
        this.initGPIO();
        this.renderCanvas();
    }

    initGPIO() {
        // Initialize GPIO pins 0-39
        for (let i = 0; i < 40; i++) {
            this.gpioState[i] = { mode: 'input', value: 0 };
        }
        // Set pin 2 as output (built-in LED)
        this.gpioState[2].mode = 'output';
        this.updateGPIOView();
    }

    updateGPIOView() {
        const table = document.getElementById('gpioTable');
        table.innerHTML = '';
        for (let i = 0; i < 40; i++) {
            const row = document.createElement('tr');
            row.innerHTML = `<td>${i}</td><td>${this.gpioState[i].mode}</td><td>${this.gpioState[i].value}</td>`;
            table.appendChild(row);
        }
    }

    logSerial(message) {
        const logDiv = document.getElementById('serialLog');
        logDiv.textContent += message + '\n';
        logDiv.scrollTop = logDiv.scrollHeight;
    }

    renderCanvas() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        // Draw LED
        this.ctx.beginPath();
        this.ctx.arc(this.ledX, this.ledY, this.ledRadius, 0, Math.PI * 2);
        this.ctx.fillStyle = this.ledOn ? '#ff4444' : '#444444';
        this.ctx.fill();
        this.ctx.strokeStyle = '#888';
        this.ctx.stroke();
        // Draw label
        this.ctx.fillStyle = 'white';
        this.ctx.font = '16px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('GPIO 2 (LED)', this.ledX, this.ledY + this.ledRadius + 20);
    }

    start() {
        if (this.running) return;
        this.running = true;
        this.logSerial('ESP32 Emulator started');
        this.interval = setInterval(() => {
            // Simulate blink sketch: toggle GPIO2 every second
            this.gpioState[2].value = this.gpioState[2].value ? 0 : 1;
            this.ledOn = this.gpioState[2].value === 1;
            this.updateGPIOView();
            this.renderCanvas();
            this.logSerial(this.ledOn ? 'LED ON' : 'LED OFF');
        }, 1000);
        this.logSerial('Blink sketch running...');
    }

    stop() {
        if (!this.running) return;
        clearInterval(this.interval);
        this.running = false;
        this.logSerial('Emulator stopped');
    }

    reset() {
        this.stop();
        this.initGPIO();
        this.ledOn = false;
        this.renderCanvas();
        document.getElementById('serialLog').textContent = '';
        this.logSerial('ESP32 reset');
    }
}

const emulator = new ESP32Emulator();

// UI functions
function loadEmulator() {
    const status = document.getElementById('status');
    status.className = 'status running';
    status.textContent = 'Emulator loaded (mock)';
    document.getElementById('startBtn').disabled = false;
    document.getElementById('stopBtn').disabled = false;
    document.getElementById('resetBtn').disabled = false;
    emulator.logSerial('QEMU WASM module loaded (simulated)');
}

function startEmulation() {
    emulator.start();
}

function stopEmulation() {
    emulator.stop();
}

function resetEmulation() {
    emulator.reset();
}

// Initialize buttons state
window.onload = function() {
    document.getElementById('startBtn').disabled = true;
    document.getElementById('stopBtn').disabled = true;
    document.getElementById('resetBtn').disabled = true;
};