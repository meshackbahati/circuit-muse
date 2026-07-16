/**
 * STM32 QEMU download prompt (desktop / Tauri only).
 */

import { isStm32BoardKind } from '../types/board';
import { QemuDownloadPrompt, type QemuRuntimeConfig } from './QemuDownloadPrompt';

const STM32_CONFIG: QemuRuntimeConfig = {
  label: 'STM32',
  matchKind: (kind) => isStm32BoardKind(kind),
  statusCmd: 'stm32_qemu_status',
  installCmd: 'stm32_qemu_install',
  progressEvent: 'stm32-qemu-progress',
  sizeNote: '~30 MB',
};

export const Stm32QemuPrompt = () => <QemuDownloadPrompt config={STM32_CONFIG} />;
