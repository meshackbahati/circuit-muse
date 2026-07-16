import asyncio
import sys
import os
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from app.services.qemu_manager import qemu_manager

async def test_real_qemu():
    print("Testing real QEMU launch...")
    
    async def callback(event_type, data):
        if event_type == "serial_output":
            print(f"[SERIAL] {data.get('data')}", end="")
            if "Booting Linux" in data.get("data", ""):
                print("\n✓ Linux boot detected in serial!")
        else:
            print(f"[{event_type.upper()}] {data}")

    qemu_manager.start_instance("debug-client", "raspberry-pi-3", callback)
    
    print("Waiting 30 seconds for boot output...")
    # Wait some time to see if QEMU starts and prints something
    await asyncio.sleep(30)
    
    qemu_manager.stop_instance("debug-client")
    print("Test finished.")

if __name__ == "__main__":
    asyncio.run(test_real_qemu())
