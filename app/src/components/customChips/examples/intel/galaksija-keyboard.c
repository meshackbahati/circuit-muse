/*
 * galaksija-keyboard — Galaksija memory-mapped keyboard (Phase 3,
 * project/multichip-bus/). Replicates the scheme used by the libretro Galaksija
 * core: the keyboard occupies addresses 0x2000-0x203F; reading 0x2000+offset
 * returns 0xFE when the key at that matrix offset is pressed, 0xFF otherwise.
 * The chip drives the data bus on a memory READ in that range and exposes
 * set_key(offset, down) for the host to push browser key events. It never
 * drives outside the keyboard range; the paired galaksija-ram releases reads in
 * 0x2000-0x203F so the two never fight for the bus.
 */
#include "velxio-chip.h"
#include <stdint.h>
#include <stdbool.h>

static vx_pin a[14], d[8], rd;
static int rd_last;
static bool driving;
static uint8_t keys[64];

static uint16_t read_addr(void){ uint16_t v=0; for(int i=0;i<14;i++) if(vx_pin_read(a[i])) v|=(1u<<i); return v; }
static int in_range(uint16_t addr){ return (addr & 0x3FC0) == 0x2000; } /* 0x2000-0x203F */
static void drive_data(uint8_t v){ for(int i=0;i<8;i++){ vx_pin_set_mode(d[i],VX_OUTPUT); vx_pin_write(d[i],(v>>i)&1);} driving=true; }
static void release_data(void){ if(!driving) return; for(int i=0;i<8;i++) vx_pin_set_mode(d[i],VX_INPUT); driving=false; }

static void update(void){
  if(vx_pin_read(rd)==0){ uint16_t addr=read_addr(); if(in_range(addr)) drive_data(keys[addr & 0x3F]); else release_data(); }
  else release_data();
}
static void on_change(void* u, vx_pin p, int v){ (void)u;(void)p;(void)v; update(); }

/* Exported: the host (browser keydown/keyup bridge) sets a key's state. */
void set_key(int offset, int down){ if(offset>=0 && offset<64) keys[offset] = down ? 0xFE : 0xFF; }

void chip_setup(void){
  char name[4];
  for(int i=0;i<14;i++){ name[0]='A'; if(i<10){name[1]='0'+i;name[2]=0;} else {name[1]='1';name[2]='0'+(i-10);name[3]=0;} a[i]=vx_pin_register(name,VX_INPUT);}
  for(int i=0;i<8;i++){ name[0]='D';name[1]='0'+i;name[2]=0; d[i]=vx_pin_register(name,VX_INPUT);}
  rd=vx_pin_register("RD",VX_INPUT); rd_last=vx_pin_read(rd); driving=false;
  for(int i=0;i<64;i++) keys[i]=0xFF; /* all released */
  for(int i=0;i<14;i++) vx_pin_watch(a[i],VX_EDGE_BOTH,on_change,0);
  vx_pin_watch(rd,VX_EDGE_BOTH,on_change,0);
  update();
}
