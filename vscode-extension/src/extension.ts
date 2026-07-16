/**
 * Velxio VS Code Extension — Entry point
 *
 * Provides commands to compile, simulate, and interact with Arduino/ESP32
 * sketches directly within VS Code. Simulation runs locally using avr8js,
 * rp2040js (in the WebView), and QEMU (via the backend) for ESP32 boards.
 */

import * as vscode from 'vscode';
import { SimulatorPanel } from './SimulatorPanel';
import { BackendManager } from './BackendManager';
import { ProjectConfig } from './ProjectConfig';
import { SerialTerminal } from './SerialTerminal';
import { FileWatcher } from './FileWatcher';
import {
  EntitlementError,
  LicenseService,
  OfflineError,
  type ValidationResult,
} from './LicenseService';
import { BOARD_LABELS, type BoardKind } from './types';

let backend: BackendManager;
let serialTerminal: SerialTerminal;
let fileWatcher: FileWatcher;
let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;
let licenseStatusBarItem: vscode.StatusBarItem;
let licenseService: LicenseService;

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('Velxio');
  backend = new BackendManager(outputChannel);
  serialTerminal = new SerialTerminal();
  fileWatcher = new FileWatcher();
  licenseService = new LicenseService(context);

  // Status bar item showing current board
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  statusBarItem.command = 'velxio.selectBoard';
  statusBarItem.tooltip = 'Click to change board';
  updateStatusBar('arduino-uno');

  // Status bar item showing license / subscription state
  licenseStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 49);
  licenseStatusBarItem.command = 'velxio.showLicenseStatus';
  renderLicenseStatusBar(null);
  licenseStatusBarItem.show();
  // Refresh asynchronously so the bar isn't blank for the first few seconds.
  void refreshLicenseStatusBar();

  // URI handler for the OAuth deep-link round-trip.
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri: (uri) => handleAuthUri(uri),
    }),
  );

  // ── Commands ──────────────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand('velxio.openSimulator', () => {
      const panel = SimulatorPanel.createOrShow(context.extensionUri);
      setupPanelListeners(panel, context);
      statusBarItem.show();
    }),

    vscode.commands.registerCommand('velxio.compile', async () => {
      await compileAndLoad(context);
    }),

    vscode.commands.registerCommand('velxio.run', async () => {
      // Gate up-front so we don't open the panel just to immediately
      // bounce the user to a "please sign in" modal.
      const gate = await ensureLicensed();
      if (!gate) return;

      const panel = SimulatorPanel.createOrShow(context.extensionUri);
      setupPanelListeners(panel, context);

      if (!panel.ready) {
        // Wait for the WebView to initialize
        await new Promise<void>(resolve => {
          const disposable = panel.onReady(() => { disposable.dispose(); resolve(); });
        });
      }

      await compileAndLoad(context);
      panel.start();
    }),

    vscode.commands.registerCommand('velxio.stop', () => {
      const panel = SimulatorPanel.createOrShow(context.extensionUri);
      panel.stop();
    }),

    vscode.commands.registerCommand('velxio.signIn', async () => {
      try {
        const { signInUrl } = await licenseService.beginSignIn();
        const opened = await vscode.env.openExternal(vscode.Uri.parse(signInUrl));
        if (!opened) {
          vscode.window.showWarningMessage(
            'Could not open the sign-in page in your browser. Copy the URL from the output panel.',
          );
          outputChannel.appendLine(`[license] sign-in URL: ${signInUrl}`);
        } else {
          outputChannel.appendLine('[license] sign-in flow started — complete in browser');
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Sign-in failed: ${msg}`);
      }
    }),

    vscode.commands.registerCommand('velxio.pasteLicenseKey', async () => {
      const value = await vscode.window.showInputBox({
        prompt: 'Paste your Velxio license key',
        placeHolder: 'vlx_pro_… or vlx_trial_…',
        password: true,
        ignoreFocusOut: true,
        validateInput: (v) => {
          const trimmed = v.trim();
          if (!trimmed) return 'License key cannot be empty.';
          if (!/^vlx_[a-z_]+_[0-9a-f]+$/.test(trimmed)) {
            return 'That doesn\'t look like a Velxio key (expected format: vlx_<plan>_<hex>).';
          }
          return null;
        },
      });
      if (!value) return;
      await licenseService.setKey(value);
      try {
        const result = await licenseService.validate({ skipCache: true });
        if (result.valid && result.entitlements?.vscode_ext) {
          vscode.window.showInformationMessage(
            `Velxio key accepted. Plan: ${result.plan ?? 'unknown'}.`,
          );
        } else {
          vscode.window.showWarningMessage(licenseService.reasonToMessage(result));
        }
      } catch (err) {
        if (err instanceof OfflineError) {
          vscode.window.showWarningMessage(err.message);
        } else {
          vscode.window.showErrorMessage(
            `Validation failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      await refreshLicenseStatusBar();
    }),

    vscode.commands.registerCommand('velxio.signOut', async () => {
      const choice = await vscode.window.showWarningMessage(
        'Sign out of Velxio? You will need to sign in again to compile or run sketches.',
        { modal: true },
        'Sign out',
      );
      if (choice !== 'Sign out') return;
      await licenseService.clearKey();
      await refreshLicenseStatusBar();
      vscode.window.showInformationMessage('Signed out of Velxio.');
    }),

    vscode.commands.registerCommand('velxio.showLicenseStatus', async () => {
      const key = await licenseService.getKey();
      if (!key) {
        const action = await vscode.window.showInformationMessage(
          'You are not signed in to Velxio. Compile and Run are disabled.',
          'Sign In',
          'Paste License Key',
          'View Pricing',
        );
        if (action === 'Sign In') vscode.commands.executeCommand('velxio.signIn');
        if (action === 'Paste License Key') vscode.commands.executeCommand('velxio.pasteLicenseKey');
        if (action === 'View Pricing') {
          vscode.env.openExternal(vscode.Uri.parse('https://velxio.dev/pricing'));
        }
        return;
      }
      try {
        const result = await licenseService.validate({ skipCache: true });
        await refreshLicenseStatusBar(result);
        const summary = renderStatusSummary(result);
        const buttons: string[] = [];
        if (!result.valid) buttons.push('Open Billing');
        buttons.push('Sign Out');
        const action = await vscode.window.showInformationMessage(summary, ...buttons);
        if (action === 'Open Billing') {
          vscode.env.openExternal(vscode.Uri.parse('https://velxio.dev/billing'));
        }
        if (action === 'Sign Out') vscode.commands.executeCommand('velxio.signOut');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`License check failed: ${msg}`);
      }
    }),

    vscode.commands.registerCommand('velxio.selectBoard', async () => {
      const boards = Object.entries(BOARD_LABELS) as [BoardKind, string][];
      const items = boards.map(([kind, label]) => ({
        label,
        description: kind,
        kind: kind,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a board',
        title: 'Velxio: Select Board',
      });

      if (selected) {
        const boardKind = selected.description as BoardKind;
        updateStatusBar(boardKind);

        // Update velxio.toml if it exists
        const workspaceRoot = getWorkspaceRoot();
        if (workspaceRoot) {
          const config = new ProjectConfig(workspaceRoot);
          const existingConfig = config.readVelxioToml();
          if (existingConfig) {
            await config.createDefaultConfig(boardKind);
          }
        }

        // Update the WebView
        try {
          const panel = SimulatorPanel.createOrShow(context.extensionUri);
          panel.setBoard(boardKind);
        } catch {
          // Panel not open yet, that's fine
        }
      }
    }),
  );

  // ── Auto-activation ───────────────────────────────────────────────────────

  // If velxio.toml or diagram.json exists, show the status bar
  const workspaceRoot = getWorkspaceRoot();
  if (workspaceRoot) {
    const config = new ProjectConfig(workspaceRoot);
    const velxioConfig = config.readVelxioToml();
    if (velxioConfig) {
      updateStatusBar(config.getBoard());
      statusBarItem.show();
    }
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  context.subscriptions.push(
    outputChannel,
    statusBarItem,
    licenseStatusBarItem,
    serialTerminal,
    fileWatcher,
    { dispose: () => { backend.stop(); } },
  );

  outputChannel.appendLine('Velxio extension activated');
}

export function deactivate() {
  backend.stop();
  fileWatcher.stop();
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function getWorkspaceRoot(): string | null {
  const folders = vscode.workspace.workspaceFolders;
  return folders?.[0]?.uri.fsPath ?? null;
}

function updateStatusBar(board: BoardKind): void {
  const label = BOARD_LABELS[board] ?? board;
  statusBarItem.text = `$(circuit-board) ${label}`;
}

let panelListenersSet = false;

function setupPanelListeners(panel: SimulatorPanel, context: vscode.ExtensionContext): void {
  if (panelListenersSet) return;
  panelListenersSet = true;

  // Wire serial output to the VS Code terminal
  panel.onSerialOutput((text) => {
    serialTerminal.write(text);
  });

  // Wire terminal input back to the simulation
  serialTerminal.onInput((text) => {
    panel.serialInput(text);
  });

  // When the panel is ready, send initial configuration
  panel.onReady(async () => {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) return;

    const config = new ProjectConfig(workspaceRoot);
    const board = config.getBoard();
    panel.setBoard(board);

    // Read diagram.json if it exists
    const diagram = config.readDiagramJson();
    if (diagram) {
      panel.postMessage({ type: 'setDiagram', diagram });
    }

    // Start backend if needed (for ESP32 boards)
    if (needsBackend(board)) {
      try {
        await backend.start();
        panel.setApiBase(backend.apiBase);
      } catch (err) {
        outputChannel.appendLine(`[Backend] Failed to start: ${err}`);
      }
    }
  });
}

function needsBackend(board: BoardKind): boolean {
  // Arduino compilation always needs the backend
  // ESP32 boards also need QEMU via the backend WebSocket
  return true; // For MVP, always start the backend
}

async function compileAndLoad(context: vscode.ExtensionContext): Promise<void> {
  const gate = await ensureLicensed();
  if (!gate) return;

  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) {
    vscode.window.showErrorMessage('No workspace folder open');
    return;
  }

  const config = new ProjectConfig(workspaceRoot);
  const board = config.getBoard();
  const language = config.getLanguageMode();

  const panel = SimulatorPanel.createOrShow(context.extensionUri);
  setupPanelListeners(panel, context);

  // Check for pre-compiled firmware first
  const firmwarePath = config.getFirmwarePath();
  if (firmwarePath) {
    outputChannel.appendLine(`[Compile] Loading pre-compiled firmware: ${firmwarePath}`);
    const fs = await import('fs');
    const data = fs.readFileSync(firmwarePath);

    if (firmwarePath.endsWith('.hex')) {
      panel.loadHex(data.toString('utf-8'), board);
    } else {
      panel.loadBinary(data.toString('base64'), board);
    }
    return;
  }

  // MicroPython: just send .py files
  if (language === 'micropython') {
    const files = await config.getSketchFiles();
    panel.loadMicroPython(files, board);
    return;
  }

  // Arduino: compile via backend
  try {
    await backend.start();

    const files = await config.getSketchFiles();
    outputChannel.appendLine(`[Compile] Compiling ${files.length} files for ${board}...`);

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Velxio: Compiling...' },
      async () => {
        const response = await fetch(`${backend.apiBase}/compile`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            files: files.map(f => ({ name: f.name, content: f.content })),
            board_fqbn: getBoardFqbn(board),
          }),
        });

        if (!response.ok) {
          const error = await response.json() as { detail?: string };
          throw new Error(error.detail ?? `Compilation failed (${response.status})`);
        }

        const result = await response.json() as { hex?: string; binary?: string };
        if (result.hex) {
          panel.loadHex(result.hex, board);
          outputChannel.appendLine('[Compile] Success — hex loaded');
        }
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Compilation failed: ${msg}`);
    outputChannel.appendLine(`[Compile] Error: ${msg}`);
  }
}

function getBoardFqbn(board: BoardKind): string {
  const fqbnMap: Record<string, string> = {
    'arduino-uno': 'arduino:avr:uno',
    'arduino-nano': 'arduino:avr:nano:cpu=atmega328',
    'arduino-mega': 'arduino:avr:mega',
    'raspberry-pi-pico': 'rp2040:rp2040:rpipico',
    'pi-pico-w': 'rp2040:rp2040:rpipicow',
    'esp32': 'esp32:esp32:esp32',
    'esp32-s3': 'esp32:esp32:esp32s3',
    'esp32-c3': 'esp32:esp32:esp32c3',
    'attiny85': 'ATTinyCore:avr:attinyx5:chip=85,clock=internal16mhz',
  };
  return fqbnMap[board] ?? 'arduino:avr:uno';
}

// ── License gate ────────────────────────────────────────────────────────────

/**
 * Validates the stored key (or prompts the user to sign in) before any
 * compile/run. Returns true if the caller should proceed; false if it
 * should bail (the user was shown an actionable message either way).
 */
async function ensureLicensed(): Promise<boolean> {
  const key = await licenseService.getKey();
  if (!key) {
    const action = await vscode.window.showWarningMessage(
      'Velxio Pro subscription required. 30-day free trial available.',
      'Sign In',
      'Paste License Key',
      'View Pricing',
    );
    if (action === 'Sign In') vscode.commands.executeCommand('velxio.signIn');
    if (action === 'Paste License Key') vscode.commands.executeCommand('velxio.pasteLicenseKey');
    if (action === 'View Pricing') {
      vscode.env.openExternal(vscode.Uri.parse('https://velxio.dev/pricing'));
    }
    return false;
  }
  try {
    const result = await licenseService.requireValid();
    await refreshLicenseStatusBar(result);
    return true;
  } catch (err) {
    if (err instanceof OfflineError) {
      vscode.window.showErrorMessage(err.message);
      return false;
    }
    if (err instanceof EntitlementError) {
      const reason = err.result.reason_code;
      const buttons =
        reason === 'trial_expired' || reason === 'expired'
          ? ['Open Billing', 'Sign In with Different Account']
          : ['Sign In', 'Paste License Key', 'View Pricing'];
      const action = await vscode.window.showErrorMessage(err.message, ...buttons);
      if (action === 'Open Billing') {
        vscode.env.openExternal(vscode.Uri.parse('https://velxio.dev/billing'));
      }
      if (action === 'Sign In' || action === 'Sign In with Different Account') {
        vscode.commands.executeCommand('velxio.signIn');
      }
      if (action === 'Paste License Key') {
        vscode.commands.executeCommand('velxio.pasteLicenseKey');
      }
      if (action === 'View Pricing') {
        vscode.env.openExternal(vscode.Uri.parse('https://velxio.dev/pricing'));
      }
      await refreshLicenseStatusBar(err.result);
      return false;
    }
    vscode.window.showErrorMessage(
      `Velxio license check failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

async function handleAuthUri(uri: vscode.Uri): Promise<void> {
  if (uri.path !== '/auth') {
    outputChannel.appendLine(`[license] unrecognised URI path: ${uri.path}`);
    return;
  }
  const query = new URLSearchParams(uri.query);
  const token = query.get('token');
  const state = query.get('state');
  try {
    const result = await licenseService.completeSignIn(token, state);
    if (result.valid && result.entitlements?.vscode_ext) {
      vscode.window.showInformationMessage(
        `Signed in to Velxio. Plan: ${result.plan ?? 'unknown'}.`,
      );
    } else {
      vscode.window.showWarningMessage(licenseService.reasonToMessage(result));
    }
  } catch (err) {
    vscode.window.showErrorMessage(
      `Sign-in failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  await refreshLicenseStatusBar();
}

function renderLicenseStatusBar(result: ValidationResult | null): void {
  if (!result) {
    licenseStatusBarItem.text = '$(circle-slash) Velxio: Sign in';
    licenseStatusBarItem.tooltip = 'Click to sign in or paste a license key';
    licenseStatusBarItem.backgroundColor = new vscode.ThemeColor(
      'statusBarItem.warningBackground',
    );
    return;
  }
  if (!result.valid) {
    licenseStatusBarItem.text =
      result.reason_code === 'trial_expired'
        ? '$(error) Velxio: Trial ended'
        : '$(error) Velxio: Inactive';
    licenseStatusBarItem.tooltip = licenseService.reasonToMessage(result);
    licenseStatusBarItem.backgroundColor = new vscode.ThemeColor(
      'statusBarItem.errorBackground',
    );
    return;
  }
  if (result.plan === 'trial' && result.trial_ends_at) {
    const daysLeft = Math.max(
      0,
      Math.floor((new Date(result.trial_ends_at).getTime() - Date.now()) / 86_400_000),
    );
    licenseStatusBarItem.text = `$(clock) Velxio: Trial ${daysLeft}d`;
    licenseStatusBarItem.tooltip = `Trial ends ${new Date(result.trial_ends_at).toLocaleString()}`;
    licenseStatusBarItem.backgroundColor = undefined;
    return;
  }
  if (result.plan === 'pro_max') {
    licenseStatusBarItem.text = '$(verified) Velxio: Pro Max';
  } else if (result.plan === 'pro') {
    licenseStatusBarItem.text = '$(verified) Velxio: Pro';
  } else {
    licenseStatusBarItem.text = `$(verified) Velxio: ${result.plan ?? 'active'}`;
  }
  licenseStatusBarItem.tooltip = 'License active. Click for details.';
  licenseStatusBarItem.backgroundColor = undefined;
}

async function refreshLicenseStatusBar(known?: ValidationResult): Promise<void> {
  if (known) {
    renderLicenseStatusBar(known);
    return;
  }
  const key = await licenseService.getKey();
  if (!key) {
    renderLicenseStatusBar(null);
    return;
  }
  try {
    const result = await licenseService.validate();
    renderLicenseStatusBar(result);
  } catch {
    // Network down — leave the previous render in place. The next
    // compile attempt will surface the OfflineError to the user.
  }
}

function renderStatusSummary(result: ValidationResult): string {
  const lines: string[] = [];
  lines.push(`Status: ${result.valid ? 'active' : 'inactive'}`);
  if (result.plan) lines.push(`Plan: ${result.plan}`);
  if (result.trial_ends_at) {
    lines.push(`Trial ends: ${new Date(result.trial_ends_at).toLocaleString()}`);
  }
  if (result.subscription_period_end) {
    lines.push(
      `Renews / expires: ${new Date(result.subscription_period_end).toLocaleString()}`,
    );
  }
  if (!result.valid) lines.push(licenseService.reasonToMessage(result));
  return lines.join(' · ');
}
