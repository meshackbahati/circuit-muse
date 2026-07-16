import React, { useState, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useTranslation, Trans } from 'react-i18next';
import { AppHeader } from '../components/layout/AppHeader';
import { CodeBlock } from '../components/layout/CodeBlock';
import { useLocalizedHref } from '../i18n/useLocalizedNavigate';
import './DocsPage.css';

const GITHUB_URL = 'https://github.com/davidmonterocrespo24/velxio';
const BASE_URL = 'https://velxio.dev';
const AUTHOR = {
  '@type': 'Person',
  name: 'David Montero Crespo',
  url: 'https://github.com/davidmonterocrespo24',
} as const;

/* ── Icons ─────────────────────────────────────────────── */
const IcoGitHub = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.385-1.335-1.755-1.335-1.755-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 21.795 24 17.295 24 12c0-6.63-5.37-12-12-12z" />
  </svg>
);

/* ── Doc sections ──────────────────────────────────────── */
type SectionId =
  | 'intro'
  | 'getting-started'
  | 'emulator'
  | 'riscv-emulation'
  | 'esp32-emulation'
  | 'rp2040-emulation'
  | 'raspberry-pi3-emulation'
  | 'components'
  | 'roadmap'
  | 'architecture'
  | 'third-party'
  | 'mcp'
  | 'setup'
  | 'build-qemu';

const VALID_SECTIONS: SectionId[] = [
  'intro',
  'getting-started',
  'emulator',
  'riscv-emulation',
  'esp32-emulation',
  'rp2040-emulation',
  'raspberry-pi3-emulation',
  'components',
  'roadmap',
  'architecture',
  'third-party',
  'mcp',
  'setup',
  'build-qemu',
];

interface NavItem {
  id: SectionId;
  labelKey: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'intro', labelKey: 'docs.nav.intro' },
  { id: 'getting-started', labelKey: 'docs.nav.gettingStarted' },
  { id: 'emulator', labelKey: 'docs.nav.emulator' },
  { id: 'riscv-emulation', labelKey: 'docs.nav.riscvEmulation' },
  { id: 'esp32-emulation', labelKey: 'docs.nav.esp32Emulation' },
  { id: 'rp2040-emulation', labelKey: 'docs.nav.rp2040Emulation' },
  { id: 'raspberry-pi3-emulation', labelKey: 'docs.nav.raspberryPi3Emulation' },
  { id: 'components', labelKey: 'docs.nav.components' },
  { id: 'architecture', labelKey: 'docs.nav.architecture' },
  { id: 'third-party', labelKey: 'docs.nav.thirdParty' },
  { id: 'mcp', labelKey: 'docs.nav.mcp' },
  { id: 'setup', labelKey: 'docs.nav.setup' },
  { id: 'build-qemu', labelKey: 'docs.nav.buildQemu' },
  { id: 'roadmap', labelKey: 'docs.nav.roadmap' },
];

/* ── Per-section SEO metadata ──────────────────────────── */
interface SectionMeta {
  titleKey: string;
  descriptionKey: string;
}
const SECTION_META: Record<SectionId, SectionMeta> = {
  intro: {
    titleKey: 'docs.sectionMeta.intro.title',
    descriptionKey: 'docs.sectionMeta.intro.description',
  },
  'getting-started': {
    titleKey: 'docs.sectionMeta.gettingStarted.title',
    descriptionKey: 'docs.sectionMeta.gettingStarted.description',
  },
  emulator: {
    titleKey: 'docs.sectionMeta.emulator.title',
    descriptionKey: 'docs.sectionMeta.emulator.description',
  },
  'riscv-emulation': {
    titleKey: 'docs.sectionMeta.riscvEmulation.title',
    descriptionKey: 'docs.sectionMeta.riscvEmulation.description',
  },
  'esp32-emulation': {
    titleKey: 'docs.sectionMeta.esp32Emulation.title',
    descriptionKey: 'docs.sectionMeta.esp32Emulation.description',
  },
  components: {
    titleKey: 'docs.sectionMeta.components.title',
    descriptionKey: 'docs.sectionMeta.components.description',
  },
  roadmap: {
    titleKey: 'docs.sectionMeta.roadmap.title',
    descriptionKey: 'docs.sectionMeta.roadmap.description',
  },
  architecture: {
    titleKey: 'docs.sectionMeta.architecture.title',
    descriptionKey: 'docs.sectionMeta.architecture.description',
  },
  'third-party': {
    titleKey: 'docs.sectionMeta.thirdParty.title',
    descriptionKey: 'docs.sectionMeta.thirdParty.description',
  },
  mcp: {
    titleKey: 'docs.sectionMeta.mcp.title',
    descriptionKey: 'docs.sectionMeta.mcp.description',
  },
  setup: {
    titleKey: 'docs.sectionMeta.setup.title',
    descriptionKey: 'docs.sectionMeta.setup.description',
  },
  'rp2040-emulation': {
    titleKey: 'docs.sectionMeta.rp2040Emulation.title',
    descriptionKey: 'docs.sectionMeta.rp2040Emulation.description',
  },
  'raspberry-pi3-emulation': {
    titleKey: 'docs.sectionMeta.raspberryPi3Emulation.title',
    descriptionKey: 'docs.sectionMeta.raspberryPi3Emulation.description',
  },
  'build-qemu': {
    titleKey: 'docs.sectionMeta.buildQemu.title',
    descriptionKey: 'docs.sectionMeta.buildQemu.description',
  },
};

/* ── Section content ───────────────────────────────────── */
const IntroSection: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="docs-section">
      <span className="docs-label">{t('docs.intro.label')}</span>
      <h1>{t('docs.intro.heading')}</h1>
      <p>
        <Trans i18nKey="docs.intro.lead" components={{ strong: <strong />, code: <code /> }} />
      </p>

      <h2>{t('docs.intro.whyHeading')}</h2>
      <ul>
        <li>
          <Trans i18nKey="docs.intro.whyNoInstall" components={{ strong: <strong /> }} />
        </li>
        <li>
          <Trans i18nKey="docs.intro.whyRealEmulation" components={{ strong: <strong /> }} />
        </li>
        <li>
          <Trans i18nKey="docs.intro.whyInteractive" components={{ strong: <strong /> }} />
        </li>
        <li>
          <Trans i18nKey="docs.intro.whyOpenSource" components={{ strong: <strong /> }} />
        </li>
      </ul>

      <h2>{t('docs.intro.boardsHeading')}</h2>
      <table>
        <thead>
          <tr>
            <th>{t('docs.intro.thBoard')}</th>
            <th>{t('docs.intro.thCpu')}</th>
            <th>{t('docs.intro.thEmulator')}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{t('docs.intro.boardArduinoUno')}</td>
            <td>{t('docs.intro.cpuAtmega328p')}</td>
            <td>{t('docs.intro.emuAvr8js')}</td>
          </tr>
          <tr>
            <td>{t('docs.intro.boardArduinoNano')}</td>
            <td>{t('docs.intro.cpuAtmega328p')}</td>
            <td>{t('docs.intro.emuAvr8js')}</td>
          </tr>
          <tr>
            <td>{t('docs.intro.boardArduinoMega')}</td>
            <td>{t('docs.intro.cpuAtmega2560')}</td>
            <td>{t('docs.intro.emuAvr8js')}</td>
          </tr>
          <tr>
            <td>{t('docs.intro.boardPiPico')}</td>
            <td>{t('docs.intro.cpuRp2040')}</td>
            <td>{t('docs.intro.emuRp2040js')}</td>
          </tr>
          <tr>
            <td>{t('docs.intro.boardEsp32C3')}</td>
            <td>{t('docs.intro.cpuRv32imc')}</td>
            <td>{t('docs.intro.emuEsp32C3')}</td>
          </tr>
          <tr>
            <td>{t('docs.intro.boardEsp32')}</td>
            <td>{t('docs.intro.cpuXtensa')}</td>
            <td>{t('docs.intro.emuQemu')}</td>
          </tr>
        </tbody>
      </table>

      <div className="docs-callout">
        <Trans
          i18nKey="docs.intro.liveDemoCallout"
          components={{
            strong: <strong />,
            a: <a href="https://velxio.dev" target="_blank" rel="noopener noreferrer" />,
          }}
        />
      </div>
    </div>
  );
};

const GettingStartedSection: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="docs-section">
      <span className="docs-label">{t('docs.gettingStarted.label')}</span>
      <h1>{t('docs.gettingStarted.heading')}</h1>
      <p>{t('docs.gettingStarted.lead')}</p>

      <h2>{t('docs.gettingStarted.option1Heading')}</h2>
      <p>
        <Trans
          i18nKey="docs.gettingStarted.option1Body"
          components={{
            a: <a href="https://velxio.dev" target="_blank" rel="noopener noreferrer" />,
          }}
        />
      </p>

      <h2>{t('docs.gettingStarted.option2Heading')}</h2>
      <p>{t('docs.gettingStarted.option2Body')}</p>
      <CodeBlock language="bash">{`docker run -d \\
  --name velxio \\
  -p 3080:80 \\
  -v $(pwd)/data:/app/data \\
  ghcr.io/davidmonterocrespo24/velxio:master`}</CodeBlock>
      <p>
        <Trans i18nKey="docs.gettingStarted.option2After" components={{ strong: <strong /> }} />
      </p>

      <h2>{t('docs.gettingStarted.option3Heading')}</h2>
      <p>
        <Trans
          i18nKey="docs.gettingStarted.option3Prereq"
          components={{ strong: <strong />, code: <code /> }}
        />
      </p>

      <h3>{t('docs.gettingStarted.option3Step1')}</h3>
      <CodeBlock language="bash">{`git clone https://github.com/davidmonterocrespo24/velxio.git
cd velxio`}</CodeBlock>

      <h3>{t('docs.gettingStarted.option3Step2')}</h3>
      <CodeBlock language="bash">{`cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8001`}</CodeBlock>

      <h3>{t('docs.gettingStarted.option3Step3')}</h3>
      <CodeBlock language="bash">{`cd frontend
npm install
npm run dev`}</CodeBlock>
      <p>
        <Trans i18nKey="docs.gettingStarted.option3Step3After" components={{ strong: <strong /> }} />
      </p>

      <h3>{t('docs.gettingStarted.option3Step4')}</h3>
      <CodeBlock language="bash">{`arduino-cli core update-index
arduino-cli core install arduino:avr

# For Raspberry Pi Pico support:
arduino-cli config add board_manager.additional_urls \\
  https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json
arduino-cli core install rp2040:rp2040`}</CodeBlock>

      <h2>{t('docs.gettingStarted.firstSimulationHeading')}</h2>
      <ol>
        <li>
          <Trans
            i18nKey="docs.gettingStarted.firstSim1"
            components={{
              strong: <strong />,
              a: <a href="https://velxio.dev/editor" target="_blank" rel="noopener noreferrer" />,
            }}
          />
        </li>
        <li>
          <Trans
            i18nKey="docs.gettingStarted.firstSim2"
            components={{ strong: <strong />, em: <em /> }}
          />
        </li>
        <li>
          <Trans i18nKey="docs.gettingStarted.firstSim3" components={{ strong: <strong /> }} />
        </li>
      </ol>
      <CodeBlock language="cpp">{`void setup() {
  pinMode(13, OUTPUT);
}

void loop() {
  digitalWrite(13, HIGH);
  delay(500);
  digitalWrite(13, LOW);
  delay(500);
}`}</CodeBlock>
      <ol start={4}>
        <li>
          <Trans
            i18nKey="docs.gettingStarted.firstSim4"
            components={{ strong: <strong />, code: <code /> }}
          />
        </li>
        <li>
          <Trans i18nKey="docs.gettingStarted.firstSim5" components={{ strong: <strong /> }} />
        </li>
        <li>
          <Trans i18nKey="docs.gettingStarted.firstSim6" components={{ strong: <strong /> }} />
        </li>
        <li>
          <Trans i18nKey="docs.gettingStarted.firstSim7" components={{ strong: <strong /> }} />
        </li>
      </ol>

      <h2>{t('docs.gettingStarted.troubleshootingHeading')}</h2>
      <table>
        <thead>
          <tr>
            <th>{t('docs.gettingStarted.thProblem')}</th>
            <th>{t('docs.gettingStarted.thSolution')}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <Trans
                i18nKey="docs.gettingStarted.tsArduinoCliMissingProblem"
                components={{ code: <code /> }}
              />
            </td>
            <td>
              <Trans
                i18nKey="docs.gettingStarted.tsArduinoCliMissingSolution"
                components={{ code: <code /> }}
              />
            </td>
          </tr>
          <tr>
            <td>{t('docs.gettingStarted.tsLedNoBlinkProblem')}</td>
            <td>{t('docs.gettingStarted.tsLedNoBlinkSolution')}</td>
          </tr>
          <tr>
            <td>{t('docs.gettingStarted.tsSerialEmptyProblem')}</td>
            <td>
              <Trans
                i18nKey="docs.gettingStarted.tsSerialEmptySolution"
                components={{ code: <code /> }}
              />
            </td>
          </tr>
          <tr>
            <td>{t('docs.gettingStarted.tsCompileErrorsProblem')}</td>
            <td>
              <Trans
                i18nKey="docs.gettingStarted.tsCompileErrorsSolution"
                components={{ code: <code /> }}
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
};

const EmulatorSection: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="docs-section">
      <span className="docs-label">{t('docs.emulator.label')}</span>
      <h1>{t('docs.emulator.heading')}</h1>
      <p>
        <Trans i18nKey="docs.emulator.lead" components={{ strong: <strong /> }} />
      </p>

      <h2>{t('docs.emulator.dataFlowHeading')}</h2>
      <CodeBlock language="text">{`User Code (Monaco Editor)
        │
        ▼
   Zustand Store (useEditorStore)
        │
        ▼
  FastAPI Backend ──► arduino-cli ──► .hex / .uf2 file
        │
        ▼
  AVRSimulator / RP2040Simulator
        │ loadHex()
        ▼
  CPU execution loop (~60 FPS via requestAnimationFrame)
        │
        ▼
  Port listeners (PORTB / PORTC / PORTD)
        │
        ▼
  PinManager ──► Component state ──► React re-renders`}</CodeBlock>

      <h2>{t('docs.emulator.avr8Heading')}</h2>
      <p>
        <Trans
          i18nKey="docs.emulator.avr8Body"
          components={{
            a: <a href="https://github.com/wokwi/avr8js" target="_blank" rel="noopener noreferrer" />,
          }}
        />
      </p>

      <h3>{t('docs.emulator.execLoopHeading')}</h3>
      <p>{t('docs.emulator.execLoopBody')}</p>
      <CodeBlock language="typescript">{`avrInstruction(cpu);  // decode and execute one AVR instruction
cpu.tick();           // advance peripheral timers and counters`}</CodeBlock>

      <h3>{t('docs.emulator.peripheralsHeading')}</h3>
      <table>
        <thead>
          <tr>
            <th>{t('docs.emulator.thPeripheral')}</th>
            <th>{t('docs.emulator.thDetails')}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{t('docs.emulator.perGpio')}</td>
            <td>{t('docs.emulator.perGpioDetail')}</td>
          </tr>
          <tr>
            <td>{t('docs.emulator.perTimers')}</td>
            <td>
              <Trans i18nKey="docs.emulator.perTimersDetail" components={{ code: <code /> }} />
            </td>
          </tr>
          <tr>
            <td>{t('docs.emulator.perUsart')}</td>
            <td>{t('docs.emulator.perUsartDetail')}</td>
          </tr>
          <tr>
            <td>{t('docs.emulator.perAdc')}</td>
            <td>{t('docs.emulator.perAdcDetail')}</td>
          </tr>
          <tr>
            <td>{t('docs.emulator.perSpi')}</td>
            <td>{t('docs.emulator.perSpiDetail')}</td>
          </tr>
          <tr>
            <td>{t('docs.emulator.perI2c')}</td>
            <td>{t('docs.emulator.perI2cDetail')}</td>
          </tr>
        </tbody>
      </table>

      <h3>{t('docs.emulator.pinMappingHeading')}</h3>
      <table>
        <thead>
          <tr>
            <th>{t('docs.emulator.thArduinoPin')}</th>
            <th>{t('docs.emulator.thAvrPort')}</th>
            <th>{t('docs.emulator.thBit')}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>0–7</td>
            <td>PORTD</td>
            <td>0–7</td>
          </tr>
          <tr>
            <td>8–13</td>
            <td>PORTB</td>
            <td>0–5</td>
          </tr>
          <tr>
            <td>A0–A5</td>
            <td>PORTC</td>
            <td>0–5</td>
          </tr>
        </tbody>
      </table>

      <h2>{t('docs.emulator.rp2040Heading')}</h2>
      <p>
        <Trans
          i18nKey="docs.emulator.rp2040Body"
          components={{
            a: <a href="https://github.com/wokwi/rp2040js" target="_blank" rel="noopener noreferrer" />,
          }}
        />
      </p>
      <ul>
        <li>{t('docs.emulator.rp2040Bullet1')}</li>
        <li>{t('docs.emulator.rp2040Bullet2')}</li>
        <li>{t('docs.emulator.rp2040Bullet3')}</li>
      </ul>

      <h2>{t('docs.emulator.hexHeading')}</h2>
      <p>
        <Trans
          i18nKey="docs.emulator.hexBody"
          components={{ strong: <strong />, code: <code /> }}
        />
      </p>
      <ol>
        <li>
          <Trans i18nKey="docs.emulator.hex1" components={{ code: <code /> }} />
        </li>
        <li>{t('docs.emulator.hex2')}</li>
        <li>
          <Trans i18nKey="docs.emulator.hex3" components={{ code: <code /> }} />
        </li>
        <li>
          <Trans i18nKey="docs.emulator.hex4" components={{ code: <code /> }} />
        </li>
      </ol>

      <h2>{t('docs.emulator.sourceFilesHeading')}</h2>
      <table>
        <thead>
          <tr>
            <th>{t('docs.emulator.thFile')}</th>
            <th>{t('docs.emulator.thPurpose')}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>frontend/src/simulation/AVRSimulator.ts</code>
            </td>
            <td>{t('docs.emulator.fileAvrSimDesc')}</td>
          </tr>
          <tr>
            <td>
              <code>frontend/src/simulation/PinManager.ts</code>
            </td>
            <td>{t('docs.emulator.filePinManagerDesc')}</td>
          </tr>
          <tr>
            <td>
              <code>frontend/src/utils/hexParser.ts</code>
            </td>
            <td>{t('docs.emulator.fileHexParserDesc')}</td>
          </tr>
          <tr>
            <td>
              <code>frontend/src/components/simulator/SimulatorCanvas.tsx</code>
            </td>
            <td>{t('docs.emulator.fileSimCanvasDesc')}</td>
          </tr>
          <tr>
            <td>
              <code>backend/app/services/arduino_cli.py</code>
            </td>
            <td>{t('docs.emulator.fileArduinoCliDesc')}</td>
          </tr>
          <tr>
            <td>
              <code>backend/app/api/routes/compile.py</code>
            </td>
            <td>{t('docs.emulator.fileCompileRouteDesc')}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
};

const ComponentsSection: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="docs-section">
      <span className="docs-label">{t('docs.components.label')}</span>
      <h1>{t('docs.components.heading')}</h1>
      <p>
        <Trans
          i18nKey="docs.components.lead"
          components={{
            strong: <strong />,
            a: (
              <a
                href="https://github.com/wokwi/wokwi-elements"
                target="_blank"
                rel="noopener noreferrer"
              />
            ),
          }}
        />
      </p>

      <h2>{t('docs.components.addingHeading')}</h2>
      <ol>
        <li>
          <Trans i18nKey="docs.components.adding1" components={{ strong: <strong /> }} />
        </li>
        <li>
          <Trans i18nKey="docs.components.adding2" components={{ strong: <strong /> }} />
        </li>
        <li>{t('docs.components.adding3')}</li>
        <li>
          <Trans i18nKey="docs.components.adding4" components={{ strong: <strong /> }} />
        </li>
      </ol>

      <h2>{t('docs.components.connectingHeading')}</h2>
      <ol>
        <li>
          <Trans i18nKey="docs.components.connecting1" components={{ strong: <strong /> }} />
        </li>
        <li>
          <Trans i18nKey="docs.components.connecting2" components={{ strong: <strong /> }} />
        </li>
        <li>
          <Trans i18nKey="docs.components.connecting3" components={{ strong: <strong /> }} />
        </li>
      </ol>
      <table>
        <thead>
          <tr>
            <th>{t('docs.components.thColor')}</th>
            <th>{t('docs.components.thSignalType')}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <span className="wire-dot" style={{ background: '#ef4444' }} /> {t('docs.components.colorRed')}
            </td>
            <td>{t('docs.components.sigVcc')}</td>
          </tr>
          <tr>
            <td>
              <span className="wire-dot" style={{ background: '#374151' }} /> {t('docs.components.colorBlack')}
            </td>
            <td>{t('docs.components.sigGnd')}</td>
          </tr>
          <tr>
            <td>
              <span className="wire-dot" style={{ background: '#3b82f6' }} /> {t('docs.components.colorBlue')}
            </td>
            <td>{t('docs.components.sigAnalog')}</td>
          </tr>
          <tr>
            <td>
              <span className="wire-dot" style={{ background: '#22c55e' }} /> {t('docs.components.colorGreen')}
            </td>
            <td>{t('docs.components.sigDigital')}</td>
          </tr>
          <tr>
            <td>
              <span className="wire-dot" style={{ background: '#a855f7' }} /> {t('docs.components.colorPurple')}
            </td>
            <td>{t('docs.components.sigPwm')}</td>
          </tr>
          <tr>
            <td>
              <span className="wire-dot" style={{ background: '#eab308' }} /> {t('docs.components.colorGold')}
            </td>
            <td>{t('docs.components.sigI2c')}</td>
          </tr>
          <tr>
            <td>
              <span className="wire-dot" style={{ background: '#f97316' }} /> {t('docs.components.colorOrange')}
            </td>
            <td>{t('docs.components.sigSpi')}</td>
          </tr>
          <tr>
            <td>
              <span className="wire-dot" style={{ background: '#06b6d4' }} /> {t('docs.components.colorCyan')}
            </td>
            <td>{t('docs.components.sigUsart')}</td>
          </tr>
        </tbody>
      </table>

      <h2>{t('docs.components.categoriesHeading')}</h2>

      <h3>{t('docs.components.outputHeading')}</h3>
      <table>
        <thead>
          <tr>
            <th>{t('docs.components.thComponent')}</th>
            <th>{t('docs.components.thDescription')}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{t('docs.components.compLed')}</td>
            <td>{t('docs.components.compLedDesc')}</td>
          </tr>
          <tr>
            <td>{t('docs.components.compRgbLed')}</td>
            <td>{t('docs.components.compRgbLedDesc')}</td>
          </tr>
          <tr>
            <td>{t('docs.components.comp7Seg')}</td>
            <td>{t('docs.components.comp7SegDesc')}</td>
          </tr>
          <tr>
            <td>{t('docs.components.compLcd16x2')}</td>
            <td>{t('docs.components.compLcd16x2Desc')}</td>
          </tr>
          <tr>
            <td>{t('docs.components.compLcd20x4')}</td>
            <td>{t('docs.components.compLcd20x4Desc')}</td>
          </tr>
          <tr>
            <td>{t('docs.components.compIli9341')}</td>
            <td>{t('docs.components.compIli9341Desc')}</td>
          </tr>
          <tr>
            <td>{t('docs.components.compBuzzer')}</td>
            <td>{t('docs.components.compBuzzerDesc')}</td>
          </tr>
          <tr>
            <td>{t('docs.components.compNeoPixel')}</td>
            <td>{t('docs.components.compNeoPixelDesc')}</td>
          </tr>
        </tbody>
      </table>

      <h3>{t('docs.components.inputHeading')}</h3>
      <table>
        <thead>
          <tr>
            <th>{t('docs.components.thComponent')}</th>
            <th>{t('docs.components.thDescription')}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{t('docs.components.compPushButton')}</td>
            <td>{t('docs.components.compPushButtonDesc')}</td>
          </tr>
          <tr>
            <td>{t('docs.components.compSlideSwitch')}</td>
            <td>{t('docs.components.compSlideSwitchDesc')}</td>
          </tr>
          <tr>
            <td>{t('docs.components.compPotentiometer')}</td>
            <td>{t('docs.components.compPotentiometerDesc')}</td>
          </tr>
          <tr>
            <td>{t('docs.components.compRotaryEncoder')}</td>
            <td>{t('docs.components.compRotaryEncoderDesc')}</td>
          </tr>
          <tr>
            <td>{t('docs.components.compKeypad')}</td>
            <td>{t('docs.components.compKeypadDesc')}</td>
          </tr>
          <tr>
            <td>{t('docs.components.compJoystick')}</td>
            <td>{t('docs.components.compJoystickDesc')}</td>
          </tr>
        </tbody>
      </table>

      <h3>{t('docs.components.sensorsHeading')}</h3>
      <table>
        <thead>
          <tr>
            <th>{t('docs.components.thComponent')}</th>
            <th>{t('docs.components.thDescription')}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{t('docs.components.compHcSr04')}</td>
            <td>{t('docs.components.compHcSr04Desc')}</td>
          </tr>
          <tr>
            <td>{t('docs.components.compDht22')}</td>
            <td>{t('docs.components.compDht22Desc')}</td>
          </tr>
          <tr>
            <td>{t('docs.components.compPir')}</td>
            <td>{t('docs.components.compPirDesc')}</td>
          </tr>
          <tr>
            <td>{t('docs.components.compPhoto')}</td>
            <td>{t('docs.components.compPhotoDesc')}</td>
          </tr>
          <tr>
            <td>{t('docs.components.compIrRecv')}</td>
            <td>{t('docs.components.compIrRecvDesc')}</td>
          </tr>
        </tbody>
      </table>

      <h3>{t('docs.components.passiveHeading')}</h3>
      <table>
        <thead>
          <tr>
            <th>{t('docs.components.thComponent')}</th>
            <th>{t('docs.components.thDescription')}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{t('docs.components.compResistor')}</td>
            <td>{t('docs.components.compResistorDesc')}</td>
          </tr>
          <tr>
            <td>{t('docs.components.compCapacitor')}</td>
            <td>{t('docs.components.compCapacitorDesc')}</td>
          </tr>
          <tr>
            <td>{t('docs.components.compInductor')}</td>
            <td>{t('docs.components.compInductorDesc')}</td>
          </tr>
        </tbody>
      </table>

      <h2>{t('docs.components.propsHeading')}</h2>
      <p>
        <Trans i18nKey="docs.components.propsLead" components={{ strong: <strong /> }} />
      </p>
      <table>
        <thead>
          <tr>
            <th>{t('docs.components.thProperty')}</th>
            <th>{t('docs.components.thDescription')}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{t('docs.components.propArduinoPin')}</td>
            <td>{t('docs.components.propArduinoPinDesc')}</td>
          </tr>
          <tr>
            <td>{t('docs.components.propColor')}</td>
            <td>{t('docs.components.propColorDesc')}</td>
          </tr>
          <tr>
            <td>{t('docs.components.propValue')}</td>
            <td>{t('docs.components.propValueDesc')}</td>
          </tr>
          <tr>
            <td>{t('docs.components.propRotation')}</td>
            <td>{t('docs.components.propRotationDesc')}</td>
          </tr>
          <tr>
            <td>{t('docs.components.propDelete')}</td>
            <td>{t('docs.components.propDeleteDesc')}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
};

const RoadmapSection: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="docs-section">
      <span className="docs-label">{t('docs.roadmap.label')}</span>
      <h1>{t('docs.roadmap.heading')}</h1>
      <p>{t('docs.roadmap.lead')}</p>

      <h2>{t('docs.roadmap.implementedHeading')}</h2>
      <ul>
        <li>{t('docs.roadmap.impMonaco')}</li>
        <li>{t('docs.roadmap.impMultiFile')}</li>
        <li>
          <Trans i18nKey="docs.roadmap.impArduinoCli" components={{ code: <code /> }} />
        </li>
        <li>{t('docs.roadmap.impAvr')}</li>
        <li>{t('docs.roadmap.impPeripherals')}</li>
        <li>{t('docs.roadmap.impRp2040')}</li>
        <li>{t('docs.roadmap.impWokwi')}</li>
        <li>{t('docs.roadmap.impWires')}</li>
        <li>{t('docs.roadmap.impSerial')}</li>
        <li>{t('docs.roadmap.impLibMgr')}</li>
        <li>{t('docs.roadmap.impAuth')}</li>
        <li>{t('docs.roadmap.impProjects')}</li>
        <li>{t('docs.roadmap.impExamples')}</li>
        <li>{t('docs.roadmap.impDocker')}</li>
      </ul>

      <h2>{t('docs.roadmap.inProgressHeading')}</h2>
      <ul>
        <li>{t('docs.roadmap.ipWires')}</li>
        <li>{t('docs.roadmap.ipWireErrors')}</li>
      </ul>

      <h2>{t('docs.roadmap.nearTermHeading')}</h2>
      <ul>
        <li>{t('docs.roadmap.ntUndoRedo')}</li>
        <li>
          <Trans i18nKey="docs.roadmap.ntExport" components={{ code: <code /> }} />
        </li>
        <li>{t('docs.roadmap.ntMoreBoards')}</li>
        <li>{t('docs.roadmap.ntBreadboard')}</li>
      </ul>

      <h2>{t('docs.roadmap.midTermHeading')}</h2>
      <ul>
        <li>{t('docs.roadmap.mtTypeDoc')}</li>
        <li>
          <Trans i18nKey="docs.roadmap.mtGhPages" components={{ code: <code /> }} />
        </li>
        <li>{t('docs.roadmap.mtSensors')}</li>
        <li>{t('docs.roadmap.mtEeprom')}</li>
        <li>{t('docs.roadmap.mtScope')}</li>
      </ul>

      <h2>{t('docs.roadmap.longTermHeading')}</h2>
      <ul>
        <li>{t('docs.roadmap.ltMultiplayer')}</li>
        <li>{t('docs.roadmap.ltTutorials')}</li>
        <li>{t('docs.roadmap.ltSdk')}</li>
        <li>{t('docs.roadmap.ltMobile')}</li>
      </ul>

      <div className="docs-callout">
        <Trans
          i18nKey="docs.roadmap.contributeCallout"
          components={{
            strong: <strong />,
            a: <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" />,
          }}
        />
      </div>
    </div>
  );
};

/* ── Architecture Section ─────────────────────────────── */
const ArchitectureSection: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="docs-section">
      <span className="docs-label">{t('docs.architecture.label')}</span>
      <h1>{t('docs.architecture.heading')}</h1>
      <p>{t('docs.architecture.lead')}</p>

      <h2>{t('docs.architecture.overviewHeading')}</h2>
      <CodeBlock language="text">{`Browser (React + Vite)
  ├── Monaco Editor ──► useEditorStore (Zustand)
  ├── SimulatorCanvas ──► useSimulatorStore (Zustand)
  │     ├── AVRSimulator (avr8js)   16 MHz AVR8 CPU
  │     ├── RP2040Simulator (rp2040js)
  │     ├── PinManager              pin → component mapping
  │     ├── PartSimulationRegistry  16 interactive parts
  │     └── 48+ wokwi-elements      Lit Web Components
  └── HTTP (Axios) ──► FastAPI Backend (port 8001)
        └── ArduinoCLIService ──► arduino-cli subprocess`}</CodeBlock>

      <h2>{t('docs.architecture.dataFlowsHeading')}</h2>

      <h3>{t('docs.architecture.compilationHeading')}</h3>
      <CodeBlock language="text">{`Click "Compile"
  → EditorToolbar reads all workspace files
  → POST /api/compile/  { files, board_fqbn }
  → Backend: ArduinoCLIService writes temp dir
  → arduino-cli compile --fqbn <board> --output-dir build/
  → Returns hex_content (Intel HEX string)
  → useSimulatorStore.setCompiledHex() → loadHex()`}</CodeBlock>

      <h3>{t('docs.architecture.simLoopHeading')}</h3>
      <CodeBlock language="text">{`Click "Run"
  → AVRSimulator.start()
  → requestAnimationFrame loop @ ~60 FPS
  → Each frame: Math.floor(267 000 × speed) cycles
    ├── avrInstruction(cpu)   — decode + execute one AVR instruction
    └── cpu.tick()            — advance Timer0/1/2, USART, ADC
  → PORTB/C/D write listeners fire
  → PinManager.updatePort() → per-pin callbacks
  → PartSimulationRegistry.onPinStateChange()
  → wokwi-elements update visually`}</CodeBlock>

      <h3>{t('docs.architecture.inputCompsHeading')}</h3>
      <CodeBlock language="text">{`User presses button on canvas
  → wokwi web component fires 'button-press' event
  → DynamicComponent catches event
  → PartSimulationRegistry.attachEvents() handler
  → AVRSimulator.setPinState(arduinoPin, LOW)
  → AVRIOPort.setPin() injects external pin state
  → CPU reads pin in next instruction`}</CodeBlock>

      <h2>{t('docs.architecture.storesHeading')}</h2>
      <table>
        <thead>
          <tr>
            <th>{t('docs.architecture.thStore')}</th>
            <th>{t('docs.architecture.thKeyState')}</th>
            <th>{t('docs.emulator.thPurpose')}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>useEditorStore</code>
            </td>
            <td>{t('docs.architecture.storeEditorState')}</td>
            <td>{t('docs.architecture.storeEditorPurpose')}</td>
          </tr>
          <tr>
            <td>
              <code>useSimulatorStore</code>
            </td>
            <td>{t('docs.architecture.storeSimState')}</td>
            <td>{t('docs.architecture.storeSimPurpose')}</td>
          </tr>
          <tr>
            <td>
              <code>useAuthStore</code>
            </td>
            <td>{t('docs.architecture.storeAuthState')}</td>
            <td>{t('docs.architecture.storeAuthPurpose')}</td>
          </tr>
          <tr>
            <td>
              <code>useProjectStore</code>
            </td>
            <td>{t('docs.architecture.storeProjectState')}</td>
            <td>{t('docs.architecture.storeProjectPurpose')}</td>
          </tr>
        </tbody>
      </table>

      <h2>{t('docs.architecture.routesHeading')}</h2>
      <table>
        <thead>
          <tr>
            <th>{t('docs.architecture.thRoute')}</th>
            <th>{t('docs.components.thDescription')}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>POST /api/compile/</code>
            </td>
            <td>{t('docs.architecture.routeCompileDesc')}</td>
          </tr>
          <tr>
            <td>
              <code>GET /api/compile/boards</code>
            </td>
            <td>{t('docs.architecture.routeBoardsDesc')}</td>
          </tr>
          <tr>
            <td>
              <code>GET/POST /api/auth/*</code>
            </td>
            <td>{t('docs.architecture.routeAuthDesc')}</td>
          </tr>
          <tr>
            <td>
              <code>GET/POST /api/projects/*</code>
            </td>
            <td>{t('docs.architecture.routeProjectsDesc')}</td>
          </tr>
          <tr>
            <td>
              <code>GET /api/libraries/*</code>
            </td>
            <td>{t('docs.architecture.routeLibsDesc')}</td>
          </tr>
          <tr>
            <td>
              <code>GET /health</code>
            </td>
            <td>{t('docs.architecture.routeHealthDesc')}</td>
          </tr>
        </tbody>
      </table>

      <h2>{t('docs.architecture.wireSysHeading')}</h2>
      <p>{t('docs.architecture.wireSysLead')}</p>
      <CodeBlock language="typescript">{`{
  id: string
  start: { componentId, pinName, x, y }
  end:   { componentId, pinName, x, y }
  color: string
  signalType: 'digital' | 'analog' | 'power-vcc' | 'power-gnd'
}`}</CodeBlock>
      <ul>
        <li>{t('docs.architecture.wireBullet1')}</li>
        <li>{t('docs.architecture.wireBullet2')}</li>
        <li>{t('docs.architecture.wireBullet3')}</li>
        <li>{t('docs.architecture.wireBullet4')}</li>
      </ul>

      <div className="docs-callout">
        <Trans
          i18nKey="docs.architecture.fullDetailsCallout"
          components={{
            strong: <strong />,
            a: (
              <a
                href={`${GITHUB_URL}/blob/master/docs/ARCHITECTURE.md`}
                target="_blank"
                rel="noopener noreferrer"
              />
            ),
          }}
        />
      </div>
    </div>
  );
};

/* ── Wokwi Libraries Section ──────────────────────────── */
const WokwiLibsSection: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="docs-section">
      <span className="docs-label">{t('docs.thirdParty.label')}</span>
      <h1>{t('docs.thirdParty.heading')}</h1>
      <p>
        <Trans i18nKey="docs.thirdParty.lead" components={{ code: <code /> }} />
      </p>

      <h2>{t('docs.thirdParty.clonedHeading')}</h2>
      <table>
        <thead>
          <tr>
            <th>{t('docs.thirdParty.thLibrary')}</th>
            <th>{t('docs.thirdParty.thLocation')}</th>
            <th>{t('docs.emulator.thPurpose')}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <a
                href="https://github.com/wokwi/wokwi-elements"
                target="_blank"
                rel="noopener noreferrer"
              >
                @wokwi/elements
              </a>
            </td>
            <td>
              <code>npm</code>
            </td>
            <td>{t('docs.thirdParty.libElementsDesc')}</td>
          </tr>
          <tr>
            <td>
              <a href="https://github.com/wokwi/avr8js" target="_blank" rel="noopener noreferrer">
                avr8js
              </a>
            </td>
            <td>
              <code>npm</code>
            </td>
            <td>{t('docs.thirdParty.libAvr8jsDesc')}</td>
          </tr>
          <tr>
            <td>
              <a href="https://github.com/wokwi/rp2040js" target="_blank" rel="noopener noreferrer">
                rp2040js
              </a>
            </td>
            <td>
              <code>npm</code>
            </td>
            <td>{t('docs.thirdParty.libRp2040jsDesc')}</td>
          </tr>
        </tbody>
      </table>

      <p>
        <Trans i18nKey="docs.thirdParty.npmIntro" components={{ code: <code /> }} />
      </p>

      <h2>{t('docs.thirdParty.updatingHeading')}</h2>
      <p>
        <Trans i18nKey="docs.thirdParty.updatingBody" components={{ code: <code /> }} />
      </p>

      <h3>{t('docs.thirdParty.afterBumpHeading')}</h3>
      <p>
        <Trans i18nKey="docs.thirdParty.afterBumpBody" components={{ code: <code /> }} />
      </p>
      <CodeBlock language="bash">{`git clone --depth=1 https://github.com/wokwi/wokwi-elements.git \\
  third-party/wokwi-elements
cd frontend && npm run generate:metadata`}</CodeBlock>

      <h2>{t('docs.thirdParty.availableHeading')}</h2>
      <table>
        <thead>
          <tr>
            <th>{t('docs.thirdParty.thCategory')}</th>
            <th>{t('docs.thirdParty.thComponents')}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{t('docs.thirdParty.catBoards')}</td>
            <td>{t('docs.thirdParty.catBoardsList')}</td>
          </tr>
          <tr>
            <td>{t('docs.thirdParty.catSensors')}</td>
            <td>{t('docs.thirdParty.catSensorsList')}</td>
          </tr>
          <tr>
            <td>{t('docs.thirdParty.catDisplays')}</td>
            <td>{t('docs.thirdParty.catDisplaysList')}</td>
          </tr>
          <tr>
            <td>{t('docs.thirdParty.catInput')}</td>
            <td>{t('docs.thirdParty.catInputList')}</td>
          </tr>
          <tr>
            <td>{t('docs.thirdParty.catOutput')}</td>
            <td>{t('docs.thirdParty.catOutputList')}</td>
          </tr>
          <tr>
            <td>{t('docs.thirdParty.catMotors')}</td>
            <td>{t('docs.thirdParty.catMotorsList')}</td>
          </tr>
          <tr>
            <td>{t('docs.thirdParty.catPassive')}</td>
            <td>{t('docs.thirdParty.catPassiveList')}</td>
          </tr>
          <tr>
            <td>{t('docs.thirdParty.catOther')}</td>
            <td>{t('docs.thirdParty.catOtherList')}</td>
          </tr>
        </tbody>
      </table>

      <h2>{t('docs.thirdParty.howAvrHeading')}</h2>
      <CodeBlock language="typescript">{`import { CPU, avrInstruction, AVRTimer, AVRUSART, AVRADC, AVRIOPort } from 'avr8js';

const cpu   = new CPU(programMemory);          // ATmega328p at 16 MHz
const portB = new AVRIOPort(cpu, portBConfig); // digital pins 8-13
const portC = new AVRIOPort(cpu, portCConfig); // analog pins A0-A5
const portD = new AVRIOPort(cpu, portDConfig); // digital pins 0-7

function runFrame() {
  const cycles = Math.floor(267_000 * speed);
  for (let i = 0; i < cycles; i++) {
    avrInstruction(cpu); // execute one AVR instruction
    cpu.tick();          // advance timers + peripherals
  }
  requestAnimationFrame(runFrame);
}`}</CodeBlock>

      <div className="docs-callout">
        <Trans
          i18nKey="docs.thirdParty.fullDetailsCallout"
          components={{
            strong: <strong />,
            a: (
              <a
                href={`${GITHUB_URL}/blob/master/docs/WOKWI_LIBS.md`}
                target="_blank"
                rel="noopener noreferrer"
              />
            ),
          }}
        />
      </div>
    </div>
  );
};

/* ── MCP Server Section ───────────────────────────────── */
const McpSection: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="docs-section">
      <span className="docs-label">{t('docs.mcp.label')}</span>
      <h1>{t('docs.mcp.heading')}</h1>
      <p>
        <Trans
          i18nKey="docs.mcp.lead"
          components={{
            a: (
              <a
                href="https://modelcontextprotocol.io/"
                target="_blank"
                rel="noopener noreferrer"
              />
            ),
          }}
        />
      </p>

      <h2>{t('docs.mcp.toolsHeading')}</h2>
      <table>
        <thead>
          <tr>
            <th>{t('docs.mcp.thTool')}</th>
            <th>{t('docs.components.thDescription')}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>compile_project</code>
            </td>
            <td>{t('docs.mcp.toolCompileDesc')}</td>
          </tr>
          <tr>
            <td>
              <code>run_project</code>
            </td>
            <td>{t('docs.mcp.toolRunDesc')}</td>
          </tr>
          <tr>
            <td>
              <code>import_wokwi_json</code>
            </td>
            <td>
              <Trans i18nKey="docs.mcp.toolImportDesc" components={{ code: <code /> }} />
            </td>
          </tr>
          <tr>
            <td>
              <code>export_wokwi_json</code>
            </td>
            <td>
              <Trans i18nKey="docs.mcp.toolExportDesc" components={{ code: <code /> }} />
            </td>
          </tr>
          <tr>
            <td>
              <code>create_circuit</code>
            </td>
            <td>{t('docs.mcp.toolCreateDesc')}</td>
          </tr>
          <tr>
            <td>
              <code>update_circuit</code>
            </td>
            <td>{t('docs.mcp.toolUpdateDesc')}</td>
          </tr>
          <tr>
            <td>
              <code>generate_code_files</code>
            </td>
            <td>
              <Trans i18nKey="docs.mcp.toolGenerateDesc" components={{ code: <code /> }} />
            </td>
          </tr>
        </tbody>
      </table>

      <h2>{t('docs.mcp.transportHeading')}</h2>

      <h3>{t('docs.mcp.stdioHeading')}</h3>
      <CodeBlock language="bash">{`cd backend
python mcp_server.py`}</CodeBlock>
      <p>
        <Trans i18nKey="docs.mcp.stdioConfigBody" components={{ code: <code /> }} />
      </p>
      <CodeBlock language="json">{`{
  "mcpServers": {
    "velxio": {
      "command": "python",
      "args": ["/absolute/path/to/velxio/backend/mcp_server.py"]
    }
  }
}`}</CodeBlock>

      <h3>{t('docs.mcp.sseHeading')}</h3>
      <CodeBlock language="bash">{`cd backend
python mcp_sse_server.py --port 8002`}</CodeBlock>
      <p>{t('docs.mcp.sseConfigBody')}</p>
      <CodeBlock language="json">{`{
  "mcpServers": {
    "velxio": { "url": "http://localhost:8002/sse" }
  }
}`}</CodeBlock>

      <h2>{t('docs.mcp.circuitFormatHeading')}</h2>
      <p>{t('docs.mcp.circuitFormatLead')}</p>
      <CodeBlock language="json">{`{
  "board_fqbn": "arduino:avr:uno",
  "version": 1,
  "components": [
    { "id": "led1", "type": "wokwi-led", "left": 200, "top": 100,
      "rotate": 0, "attrs": { "color": "red" } }
  ],
  "connections": [
    { "from_part": "uno", "from_pin": "13",
      "to_part": "led1", "to_pin": "A", "color": "green" }
  ]
}`}</CodeBlock>

      <h3>{t('docs.mcp.fqbnHeading')}</h3>
      <table>
        <thead>
          <tr>
            <th>{t('docs.intro.thBoard')}</th>
            <th>{t('docs.mcp.thFqbn')}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{t('docs.intro.boardArduinoUno')}</td>
            <td>
              <code>arduino:avr:uno</code>
            </td>
          </tr>
          <tr>
            <td>{t('docs.intro.boardArduinoMega')}</td>
            <td>
              <code>arduino:avr:mega</code>
            </td>
          </tr>
          <tr>
            <td>{t('docs.intro.boardArduinoNano')}</td>
            <td>
              <code>arduino:avr:nano</code>
            </td>
          </tr>
          <tr>
            <td>{t('docs.intro.boardPiPico')}</td>
            <td>
              <code>rp2040:rp2040:rpipico</code>
            </td>
          </tr>
        </tbody>
      </table>

      <h2>{t('docs.mcp.exampleHeading')}</h2>
      <CodeBlock language="json">{`// Step 1 — Create a circuit
{
  "tool": "create_circuit",
  "arguments": {
    "board_fqbn": "arduino:avr:uno",
    "components": [
      { "id": "led1", "type": "wokwi-led",
        "left": 150, "top": 100, "attrs": { "color": "red" } },
      { "id": "r1", "type": "wokwi-resistor",
        "left": 150, "top": 180, "attrs": { "value": "220" } }
    ],
    "connections": [
      { "from_part": "uno", "from_pin": "13",
        "to_part": "led1", "to_pin": "A", "color": "green" },
      { "from_part": "led1", "from_pin": "C",
        "to_part": "r1",   "to_pin": "1", "color": "black" },
      { "from_part": "r1",   "from_pin": "2",
        "to_part": "uno",  "to_pin": "GND.1", "color": "black" }
    ]
  }
}

// Step 2 — Generate code
{
  "tool": "generate_code_files",
  "arguments": {
    "circuit": "<result from Step 1>",
    "sketch_name": "blink",
    "extra_instructions": "Blink the red LED every 500ms"
  }
}

// Step 3 — Compile
{
  "tool": "compile_project",
  "arguments": {
    "files": [
      {
        "name": "blink.ino",
        "content": "void setup(){pinMode(13,OUTPUT);}\\nvoid loop(){digitalWrite(13,HIGH);delay(500);digitalWrite(13,LOW);delay(500);}"
      }
    ],
    "board": "arduino:avr:uno"
  }
}`}</CodeBlock>

      <h2>{t('docs.mcp.setupHeading')}</h2>
      <CodeBlock language="bash">{`cd backend
pip install -r requirements.txt

# Ensure arduino-cli is installed
arduino-cli version
arduino-cli core update-index
arduino-cli core install arduino:avr

# Run tests
python -m pytest tests/test_mcp_tools.py -v`}</CodeBlock>

      <div className="docs-callout">
        <Trans
          i18nKey="docs.mcp.fullRefCallout"
          components={{
            strong: <strong />,
            a: (
              <a
                href={`${GITHUB_URL}/blob/master/docs/MCP.md`}
                target="_blank"
                rel="noopener noreferrer"
              />
            ),
          }}
        />
      </div>
    </div>
  );
};

/* ── Setup / Project Status Section ──────────────────── */
const SetupSection: React.FC = () => {
  const { t } = useTranslation();
  const ok = t('docs.setup.statWorking');
  return (
    <div className="docs-section">
      <span className="docs-label">{t('docs.setup.label')}</span>
      <h1>{t('docs.setup.heading')}</h1>
      <p>{t('docs.setup.lead')}</p>

      <h2>{t('docs.setup.avrHeading')}</h2>
      <table>
        <thead>
          <tr>
            <th>{t('docs.setup.thFeature')}</th>
            <th>{t('docs.setup.thStatus')}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{t('docs.setup.featAtmega')}</td>
            <td>{ok}</td>
          </tr>
          <tr>
            <td>{t('docs.setup.featTimers')}</td>
            <td>{ok}</td>
          </tr>
          <tr>
            <td>{t('docs.setup.featUsart')}</td>
            <td>{ok}</td>
          </tr>
          <tr>
            <td>
              <Trans i18nKey="docs.setup.featAdc" components={{ code: <code /> }} />
            </td>
            <td>{ok}</td>
          </tr>
          <tr>
            <td>{t('docs.setup.featGpio')}</td>
            <td>{ok}</td>
          </tr>
          <tr>
            <td>{t('docs.setup.feat60fps')}</td>
            <td>{ok}</td>
          </tr>
          <tr>
            <td>{t('docs.setup.featSpeed')}</td>
            <td>{ok}</td>
          </tr>
          <tr>
            <td>{t('docs.setup.featPwm')}</td>
            <td>{ok}</td>
          </tr>
          <tr>
            <td>{t('docs.setup.featInjection')}</td>
            <td>{ok}</td>
          </tr>
        </tbody>
      </table>

      <h2>{t('docs.setup.compSysHeading')}</h2>
      <table>
        <thead>
          <tr>
            <th>{t('docs.setup.thFeature')}</th>
            <th>{t('docs.setup.thStatus')}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{t('docs.setup.featAst')}</td>
            <td>{t('docs.setup.statAstDetected')}</td>
          </tr>
          <tr>
            <td>{t('docs.setup.featPicker')}</td>
            <td>{ok}</td>
          </tr>
          <tr>
            <td>{t('docs.setup.featCategories')}</td>
            <td>{ok}</td>
          </tr>
          <tr>
            <td>{t('docs.setup.featDynRender')}</td>
            <td>{ok}</td>
          </tr>
          <tr>
            <td>{t('docs.setup.featDnd')}</td>
            <td>{ok}</td>
          </tr>
          <tr>
            <td>{t('docs.setup.featRotation')}</td>
            <td>{ok}</td>
          </tr>
          <tr>
            <td>{t('docs.setup.featPropsDialog')}</td>
            <td>{ok}</td>
          </tr>
          <tr>
            <td>{t('docs.setup.featPinOverlay')}</td>
            <td>{ok}</td>
          </tr>
        </tbody>
      </table>

      <h2>{t('docs.setup.partsHeading')}</h2>
      <table>
        <thead>
          <tr>
            <th>{t('docs.setup.thPart')}</th>
            <th>{t('docs.setup.thType')}</th>
            <th>{t('docs.setup.thStatus')}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{t('docs.setup.partLed')}</td>
            <td>{t('docs.setup.typeOutput')}</td>
            <td>{ok}</td>
          </tr>
          <tr>
            <td>{t('docs.setup.partRgb')}</td>
            <td>{t('docs.setup.typeOutputDigPwm')}</td>
            <td>{ok}</td>
          </tr>
          <tr>
            <td>{t('docs.setup.partLedBar')}</td>
            <td>{t('docs.setup.typeOutput')}</td>
            <td>{ok}</td>
          </tr>
          <tr>
            <td>{t('docs.setup.part7Seg')}</td>
            <td>{t('docs.setup.typeOutput')}</td>
            <td>{ok}</td>
          </tr>
          <tr>
            <td>{t('docs.setup.partPushButton')}</td>
            <td>{t('docs.setup.typeInput')}</td>
            <td>{ok}</td>
          </tr>
          <tr>
            <td>{t('docs.setup.partPushButton6')}</td>
            <td>{t('docs.setup.typeInput')}</td>
            <td>{ok}</td>
          </tr>
          <tr>
            <td>{t('docs.setup.partSlide')}</td>
            <td>{t('docs.setup.typeInput')}</td>
            <td>{ok}</td>
          </tr>
          <tr>
            <td>{t('docs.setup.partDipSwitch')}</td>
            <td>{t('docs.setup.typeInput')}</td>
            <td>{ok}</td>
          </tr>
          <tr>
            <td>{t('docs.setup.partPot')}</td>
            <td>{t('docs.setup.typeInputAdc')}</td>
            <td>{ok}</td>
          </tr>
          <tr>
            <td>{t('docs.setup.partSlidePot')}</td>
            <td>{t('docs.setup.typeInputAdc')}</td>
            <td>{ok}</td>
          </tr>
          <tr>
            <td>{t('docs.setup.partPhoto')}</td>
            <td>{t('docs.setup.typeInputOutput')}</td>
            <td>{ok}</td>
          </tr>
          <tr>
            <td>{t('docs.setup.partJoystick')}</td>
            <td>{t('docs.setup.typeInputAdcDigital')}</td>
            <td>{ok}</td>
          </tr>
          <tr>
            <td>{t('docs.setup.partServo')}</td>
            <td>{t('docs.setup.typeOutput')}</td>
            <td>{ok}</td>
          </tr>
          <tr>
            <td>{t('docs.setup.partBuzzer')}</td>
            <td>{t('docs.setup.typeOutputAudio')}</td>
            <td>{ok}</td>
          </tr>
          <tr>
            <td>{t('docs.setup.partLcd1602')}</td>
            <td>{t('docs.setup.typeOutputHd44780')}</td>
            <td>{ok}</td>
          </tr>
          <tr>
            <td>{t('docs.setup.partLcd2004')}</td>
            <td>{t('docs.setup.typeOutputHd44780')}</td>
            <td>{ok}</td>
          </tr>
        </tbody>
      </table>

      <h2>{t('docs.setup.wireHeading')}</h2>
      <table>
        <thead>
          <tr>
            <th>{t('docs.setup.thFeature')}</th>
            <th>{t('docs.setup.thStatus')}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{t('docs.setup.featPinClick')}</td>
            <td>{ok}</td>
          </tr>
          <tr>
            <td>{t('docs.setup.featPreview')}</td>
            <td>{ok}</td>
          </tr>
          <tr>
            <td>{t('docs.setup.featOrtho')}</td>
            <td>{ok}</td>
          </tr>
          <tr>
            <td>{t('docs.setup.featSegEdit')}</td>
            <td>{ok}</td>
          </tr>
          <tr>
            <td>{t('docs.setup.feat8Colors')}</td>
            <td>{ok}</td>
          </tr>
          <tr>
            <td>{t('docs.setup.featAutoUpdate')}</td>
            <td>{ok}</td>
          </tr>
          <tr>
            <td>{t('docs.setup.featSnap')}</td>
            <td>{ok}</td>
          </tr>
          <tr>
            <td>{t('docs.setup.featSelDel')}</td>
            <td>{ok}</td>
          </tr>
        </tbody>
      </table>

      <h2>{t('docs.setup.examplesHeading')}</h2>
      <table>
        <thead>
          <tr>
            <th>{t('docs.setup.thExample')}</th>
            <th>{t('docs.thirdParty.thCategory')}</th>
            <th>{t('docs.setup.thDifficulty')}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{t('docs.setup.exBlink')}</td>
            <td>{t('docs.setup.catBasics')}</td>
            <td>{t('docs.setup.diffBeginner')}</td>
          </tr>
          <tr>
            <td>{t('docs.setup.exTraffic')}</td>
            <td>{t('docs.setup.catBasics')}</td>
            <td>{t('docs.setup.diffBeginner')}</td>
          </tr>
          <tr>
            <td>{t('docs.setup.exButton')}</td>
            <td>{t('docs.setup.catBasics')}</td>
            <td>{t('docs.setup.diffBeginner')}</td>
          </tr>
          <tr>
            <td>{t('docs.setup.exFade')}</td>
            <td>{t('docs.setup.catBasics')}</td>
            <td>{t('docs.setup.diffBeginner')}</td>
          </tr>
          <tr>
            <td>{t('docs.setup.exSerial')}</td>
            <td>{t('docs.setup.catComm')}</td>
            <td>{t('docs.setup.diffBeginner')}</td>
          </tr>
          <tr>
            <td>{t('docs.setup.exRgbColors')}</td>
            <td>{t('docs.setup.catBasics')}</td>
            <td>{t('docs.setup.diffIntermediate')}</td>
          </tr>
          <tr>
            <td>{t('docs.setup.exSimon')}</td>
            <td>{t('docs.setup.catGames')}</td>
            <td>{t('docs.setup.diffAdvanced')}</td>
          </tr>
          <tr>
            <td>{t('docs.setup.exLcd')}</td>
            <td>{t('docs.setup.catDisplaysCat')}</td>
            <td>{t('docs.setup.diffIntermediate')}</td>
          </tr>
        </tbody>
      </table>

      <h2>{t('docs.setup.troubleshootingHeading')}</h2>
      <table>
        <thead>
          <tr>
            <th>{t('docs.gettingStarted.thProblem')}</th>
            <th>{t('docs.gettingStarted.thSolution')}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <Trans i18nKey="docs.setup.tsModuleProblem" components={{ code: <code /> }} />
            </td>
            <td>
              <pre style={{ margin: 0 }}>
                <code>cd frontend{'\n'}npm install</code>
              </pre>
            </td>
          </tr>
          <tr>
            <td>{t('docs.setup.tsLedProblem')}</td>
            <td>{t('docs.setup.tsLedSolution')}</td>
          </tr>
          <tr>
            <td>{t('docs.setup.tsNewCompProblem')}</td>
            <td>
              <Trans i18nKey="docs.setup.tsNewCompSolution" components={{ code: <code /> }} />
            </td>
          </tr>
        </tbody>
      </table>

      <div className="docs-callout">
        <Trans
          i18nKey="docs.setup.fullStatusCallout"
          components={{
            strong: <strong />,
            a: (
              <a
                href={`${GITHUB_URL}/blob/master/docs/SETUP_COMPLETE.md`}
                target="_blank"
                rel="noopener noreferrer"
              />
            ),
          }}
        />
      </div>
    </div>
  );
};

const RiscVEmulationSection: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="docs-section">
      <span className="docs-label">{t('docs.riscv.label')}</span>
      <h1>{t('docs.riscv.heading')}</h1>
      <p>
        <Trans i18nKey="docs.riscv.lead" components={{ strong: <strong />, code: <code /> }} />
      </p>

      <h2>{t('docs.riscv.boardsHeading')}</h2>
      <div className="docs-board-gallery">
        <div className="docs-board-card">
          <img src="/boards/esp32-c3.svg" alt={t('docs.riscv.altEsp32C3')} />
          <span>{t('docs.riscv.boardEsp32C3')}</span>
        </div>
        <div className="docs-board-card">
          <img src="/boards/xiao-esp32-c3.svg" alt={t('docs.riscv.altXiaoC3')} />
          <span>{t('docs.riscv.boardXiaoC3')}</span>
        </div>
        <div className="docs-board-card">
          <img src="/boards/esp32c3-supermini.svg" alt={t('docs.riscv.altC3Super')} />
          <span>{t('docs.riscv.boardC3Super')}</span>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>{t('docs.riscv.thBoard')}</th>
            <th>{t('docs.riscv.thCpu')}</th>
            <th>{t('docs.riscv.thFlash')}</th>
            <th>{t('docs.riscv.thRam')}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{t('docs.riscv.boardEsp32C3Name')}</td>
            <td>{t('docs.riscv.cpuValue')}</td>
            <td>{t('docs.riscv.flashValue')}</td>
            <td>{t('docs.riscv.ramValue')}</td>
          </tr>
          <tr>
            <td>{t('docs.riscv.boardXiaoC3Name')}</td>
            <td>{t('docs.riscv.cpuValue')}</td>
            <td>{t('docs.riscv.flashValue')}</td>
            <td>{t('docs.riscv.ramValue')}</td>
          </tr>
          <tr>
            <td>{t('docs.riscv.boardC3SuperName')}</td>
            <td>{t('docs.riscv.cpuValue')}</td>
            <td>{t('docs.riscv.flashValue')}</td>
            <td>{t('docs.riscv.ramValue')}</td>
          </tr>
        </tbody>
      </table>

      <h2>{t('docs.riscv.memoryHeading')}</h2>
      <table>
        <thead>
          <tr>
            <th>{t('docs.riscv.thRegion')}</th>
            <th>{t('docs.riscv.thBaseAddr')}</th>
            <th>{t('docs.riscv.thSize')}</th>
            <th>{t('docs.riscv.thDescription')}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{t('docs.riscv.regIrom')}</td>
            <td>
              <code>0x42000000</code>
            </td>
            <td>{t('docs.riscv.size4mb')}</td>
            <td>{t('docs.riscv.regIromDesc')}</td>
          </tr>
          <tr>
            <td>{t('docs.riscv.regDrom')}</td>
            <td>
              <code>0x3C000000</code>
            </td>
            <td>{t('docs.riscv.size4mb')}</td>
            <td>{t('docs.riscv.regDromDesc')}</td>
          </tr>
          <tr>
            <td>{t('docs.riscv.regDram')}</td>
            <td>
              <code>0x3FC80000</code>
            </td>
            <td>{t('docs.riscv.size384kb')}</td>
            <td>{t('docs.riscv.regDramDesc')}</td>
          </tr>
          <tr>
            <td>{t('docs.riscv.regIram')}</td>
            <td>
              <code>0x4037C000</code>
            </td>
            <td>{t('docs.riscv.size384kb')}</td>
            <td>{t('docs.riscv.regIramDesc')}</td>
          </tr>
          <tr>
            <td>{t('docs.riscv.regUart')}</td>
            <td>
              <code>0x60000000</code>
            </td>
            <td>{t('docs.riscv.size1kb')}</td>
            <td>{t('docs.riscv.regUartDesc')}</td>
          </tr>
          <tr>
            <td>{t('docs.riscv.regGpio')}</td>
            <td>
              <code>0x60004000</code>
            </td>
            <td>{t('docs.riscv.size512b')}</td>
            <td>{t('docs.riscv.regGpioDesc')}</td>
          </tr>
        </tbody>
      </table>

      <h2>{t('docs.riscv.isaHeading')}</h2>
      <ul>
        <li>
          <Trans i18nKey="docs.riscv.isaRv32i" components={{ strong: <strong /> }} />
        </li>
        <li>
          <Trans i18nKey="docs.riscv.isaRv32m" components={{ strong: <strong /> }} />
        </li>
        <li>
          <Trans i18nKey="docs.riscv.isaRv32c" components={{ strong: <strong /> }} />
        </li>
      </ul>

      <h2>{t('docs.riscv.compileFlowHeading')}</h2>
      <p>
        <Trans i18nKey="docs.riscv.compileFlowLead" components={{ strong: <strong /> }} />
      </p>
      <ol>
        <li>
          <Trans i18nKey="docs.riscv.compileStep1" components={{ code: <code /> }} />
        </li>
        <li>
          <Trans
            i18nKey="docs.riscv.compileStep2"
            components={{ strong: <strong />, code: <code /> }}
          />
        </li>
        <li>
          <Trans i18nKey="docs.riscv.compileStep3" components={{ code: <code /> }} />
        </li>
        <li>
          <Trans i18nKey="docs.riscv.compileStep4" components={{ code: <code /> }} />
        </li>
        <li>{t('docs.riscv.compileStep5')}</li>
      </ol>

      <h2>{t('docs.riscv.gpioHeading')}</h2>
      <table>
        <thead>
          <tr>
            <th>{t('docs.riscv.thRegister')}</th>
            <th>{t('docs.riscv.thOffset')}</th>
            <th>{t('docs.riscv.thDescription')}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>GPIO_OUT_REG</code>
            </td>
            <td>
              <code>+0x04</code>
            </td>
            <td>{t('docs.riscv.regOutDesc')}</td>
          </tr>
          <tr>
            <td>
              <code>GPIO_OUT_W1TS</code>
            </td>
            <td>
              <code>+0x08</code>
            </td>
            <td>{t('docs.riscv.regW1tsDesc')}</td>
          </tr>
          <tr>
            <td>
              <code>GPIO_OUT_W1TC</code>
            </td>
            <td>
              <code>+0x0C</code>
            </td>
            <td>{t('docs.riscv.regW1tcDesc')}</td>
          </tr>
          <tr>
            <td>
              <code>GPIO_ENABLE_REG</code>
            </td>
            <td>
              <code>+0x20</code>
            </td>
            <td>{t('docs.riscv.regEnableDesc')}</td>
          </tr>
          <tr>
            <td>
              <code>GPIO_IN_REG</code>
            </td>
            <td>
              <code>+0x3C</code>
            </td>
            <td>{t('docs.riscv.regInDesc')}</td>
          </tr>
        </tbody>
      </table>

      <h2>{t('docs.riscv.uart0Heading')}</h2>
      <p>
        <Trans i18nKey="docs.riscv.uart0Body" components={{ code: <code /> }} />
      </p>

      <h2>{t('docs.riscv.sourceFilesHeading')}</h2>
      <table>
        <thead>
          <tr>
            <th>{t('docs.riscv.thFile')}</th>
            <th>{t('docs.riscv.thRole')}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>simulation/RiscVCore.ts</code>
            </td>
            <td>{t('docs.riscv.fileRiscVCoreDesc')}</td>
          </tr>
          <tr>
            <td>
              <code>simulation/Esp32C3Simulator.ts</code>
            </td>
            <td>{t('docs.riscv.fileEsp32C3SimDesc')}</td>
          </tr>
          <tr>
            <td>
              <code>utils/esp32ImageParser.ts</code>
            </td>
            <td>{t('docs.riscv.fileImageParserDesc')}</td>
          </tr>
        </tbody>
      </table>

      <div className="docs-callout">
        <Trans
          i18nKey="docs.riscv.fullDetailsCallout"
          components={{
            strong: <strong />,
            a: (
              <a
                href={`${GITHUB_URL}/blob/master/docs/RISCV_EMULATION.md`}
                target="_blank"
                rel="noopener noreferrer"
              />
            ),
          }}
        />
      </div>
    </div>
  );
};

const Esp32EmulationSection: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="docs-section">
      <span className="docs-label">{t('docs.esp32.label')}</span>
      <h1>{t('docs.esp32.heading')}</h1>
      <p>
        <Trans i18nKey="docs.esp32.lead" components={{ strong: <strong /> }} />
      </p>

      <div className="docs-callout">
        <Trans i18nKey="docs.esp32.noteCallout" components={{ strong: <strong /> }} />
      </div>

      <h2>{t('docs.esp32.howHeading')}</h2>
      <ol>
        <li>
          <Trans i18nKey="docs.esp32.how1" components={{ code: <code /> }} />
        </li>
        <li>
          <Trans i18nKey="docs.esp32.how2" components={{ code: <code /> }} />
        </li>
        <li>{t('docs.esp32.how3')}</li>
        <li>{t('docs.esp32.how4')}</li>
        <li>{t('docs.esp32.how5')}</li>
      </ol>

      <h2>{t('docs.esp32.boardsHeading')}</h2>
      <div className="docs-board-gallery">
        <div className="docs-board-card">
          <img src="/boards/esp32-devkit-c-v4.svg" alt={t('docs.esp32.altEsp32Devkit')} />
          <span>{t('docs.esp32.boardEsp32Devkit')}</span>
        </div>
        <div className="docs-board-card">
          <img src="/boards/esp32-s3.svg" alt={t('docs.esp32.altEsp32S3')} />
          <span>{t('docs.esp32.boardEsp32S3')}</span>
        </div>
        <div className="docs-board-card">
          <img src="/boards/esp32-cam.svg" alt={t('docs.esp32.altEsp32Cam')} />
          <span>{t('docs.esp32.boardEsp32Cam')}</span>
        </div>
        <div className="docs-board-card">
          <img src="/boards/xiao-esp32-s3.svg" alt={t('docs.esp32.altXiaoS3')} />
          <span>{t('docs.esp32.boardXiaoS3')}</span>
        </div>
        <div className="docs-board-card">
          <img src="/boards/arduino-nano-esp32.svg" alt={t('docs.esp32.altNanoEsp32')} />
          <span>{t('docs.esp32.boardNanoEsp32')}</span>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>{t('docs.esp32.thBoard')}</th>
            <th>{t('docs.esp32.thCpu')}</th>
            <th>{t('docs.esp32.thEmulation')}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{t('docs.esp32.boardEsp32')}</td>
            <td>{t('docs.esp32.cpuLx6')}</td>
            <td>{t('docs.esp32.emuQemu')}</td>
          </tr>
          <tr>
            <td>{t('docs.esp32.boardEsp32S3Name')}</td>
            <td>{t('docs.esp32.cpuLx7')}</td>
            <td>{t('docs.esp32.emuQemu')}</td>
          </tr>
        </tbody>
      </table>

      <h2>{t('docs.esp32.peripheralsHeading')}</h2>
      <ul>
        <li>
          <Trans i18nKey="docs.esp32.perGpio" components={{ strong: <strong /> }} />
        </li>
        <li>
          <Trans
            i18nKey="docs.esp32.perUart"
            components={{ strong: <strong />, code: <code /> }}
          />
        </li>
        <li>
          <Trans i18nKey="docs.esp32.perI2cSpi" components={{ strong: <strong /> }} />
        </li>
        <li>
          <Trans i18nKey="docs.esp32.perRmt" components={{ strong: <strong /> }} />
        </li>
        <li>
          <Trans i18nKey="docs.esp32.perLedc" components={{ strong: <strong /> }} />
        </li>
        <li>
          <Trans i18nKey="docs.esp32.perWifi" components={{ strong: <strong /> }} />
        </li>
      </ul>

      <h2>{t('docs.esp32.requirementsHeading')}</h2>
      <p>
        <Trans
          i18nKey="docs.esp32.requirementsBody"
          components={{
            strong: <strong />,
            a: <a href="https://velxio.dev" target="_blank" rel="noopener noreferrer" />,
          }}
        />
      </p>

      <div className="docs-callout">
        <Trans
          i18nKey="docs.esp32.fullDetailsCallout"
          components={{
            strong: <strong />,
            a: (
              <a
                href={`${GITHUB_URL}/blob/master/docs/ESP32_EMULATION.md`}
                target="_blank"
                rel="noopener noreferrer"
              />
            ),
          }}
        />
      </div>
    </div>
  );
};

/* ── RP2040 Emulation Section ─────────────────────────── */
const Rp2040EmulationSection: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="docs-section">
      <span className="docs-label">{t('docs.rp2040.label')}</span>
      <h1>{t('docs.rp2040.heading')}</h1>
      <p>
        <Trans
          i18nKey="docs.rp2040.lead"
          components={{
            a: <a href="https://github.com/wokwi/rp2040js" target="_blank" rel="noopener noreferrer" />,
          }}
        />
      </p>

      <h2>{t('docs.rp2040.boardsHeading')}</h2>
      <div className="docs-board-gallery">
        <div className="docs-board-card">
          <img src="/boards/pi-pico.svg" alt={t('docs.rp2040.altPico')} />
          <span>{t('docs.rp2040.boardPico')}</span>
        </div>
        <div className="docs-board-card">
          <img src="/boards/pi-pico-w.svg" alt={t('docs.rp2040.altPicoW')} />
          <span>{t('docs.rp2040.boardPicoW')}</span>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>{t('docs.rp2040.thBoard')}</th>
            <th>{t('docs.rp2040.thFqbn')}</th>
            <th>{t('docs.rp2040.thBuiltinLed')}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{t('docs.rp2040.boardPico')}</td>
            <td>
              <code>rp2040:rp2040:rpipico</code>
            </td>
            <td>{t('docs.rp2040.ledGpio25')}</td>
          </tr>
          <tr>
            <td>{t('docs.rp2040.boardPicoW')}</td>
            <td>
              <code>rp2040:rp2040:rpipicow</code>
            </td>
            <td>{t('docs.rp2040.ledCyw43')}</td>
          </tr>
        </tbody>
      </table>

      <h2>{t('docs.rp2040.binaryHeading')}</h2>
      <p>
        <Trans i18nKey="docs.rp2040.binaryBody1" components={{ code: <code /> }} />
      </p>
      <p>
        <Trans i18nKey="docs.rp2040.binaryBody2" components={{ code: <code /> }} />
      </p>

      <h2>{t('docs.rp2040.peripheralsHeading')}</h2>
      <table>
        <thead>
          <tr>
            <th>{t('docs.rp2040.thPeripheral')}</th>
            <th>{t('docs.rp2040.thSupport')}</th>
            <th>{t('docs.rp2040.thNotes')}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{t('docs.rp2040.perGpio')}</td>
            <td>{t('docs.rp2040.supFull')}</td>
            <td>{t('docs.rp2040.perGpioNotes')}</td>
          </tr>
          <tr>
            <td>{t('docs.rp2040.perUart')}</td>
            <td>{t('docs.rp2040.supFull')}</td>
            <td>{t('docs.rp2040.perUartNotes')}</td>
          </tr>
          <tr>
            <td>{t('docs.rp2040.perAdc')}</td>
            <td>{t('docs.rp2040.supFull')}</td>
            <td>{t('docs.rp2040.perAdcNotes')}</td>
          </tr>
          <tr>
            <td>{t('docs.rp2040.perI2c')}</td>
            <td>{t('docs.rp2040.supPartial')}</td>
            <td>{t('docs.rp2040.perI2cNotes')}</td>
          </tr>
          <tr>
            <td>{t('docs.rp2040.perSpi')}</td>
            <td>{t('docs.rp2040.supLoopback')}</td>
            <td>{t('docs.rp2040.perSpiNotes')}</td>
          </tr>
          <tr>
            <td>{t('docs.rp2040.perPwm')}</td>
            <td>{t('docs.rp2040.supFreqOnly')}</td>
            <td>{t('docs.rp2040.perPwmNotes')}</td>
          </tr>
          <tr>
            <td>{t('docs.rp2040.perTimer')}</td>
            <td>{t('docs.rp2040.supFull')}</td>
            <td>
              <Trans i18nKey="docs.rp2040.perTimerNotes" components={{ code: <code /> }} />
            </td>
          </tr>
        </tbody>
      </table>

      <h2>{t('docs.rp2040.wfiHeading')}</h2>
      <p>
        <Trans
          i18nKey="docs.rp2040.wfiBody"
          components={{ strong: <strong />, code: <code /> }}
        />
      </p>

      <h2>{t('docs.rp2040.simLoopHeading')}</h2>
      <p>
        <Trans
          i18nKey="docs.rp2040.simLoopBody"
          components={{ strong: <strong />, code: <code /> }}
        />
      </p>

      <h2>{t('docs.rp2040.limitsHeading')}</h2>
      <ul>
        <li>{t('docs.rp2040.limit1')}</li>
        <li>{t('docs.rp2040.limit2')}</li>
        <li>{t('docs.rp2040.limit3')}</li>
        <li>{t('docs.rp2040.limit4')}</li>
        <li>
          <Trans i18nKey="docs.rp2040.limit5" components={{ code: <code /> }} />
        </li>
      </ul>

      <h2>{t('docs.rp2040.fullDocsHeading')}</h2>
      <p>
        <Trans
          i18nKey="docs.rp2040.fullDocsBody"
          components={{
            a: (
              <a
                href="https://github.com/davidmonterocrespo24/velxio/blob/master/docs/RP2040_EMULATION.md"
                target="_blank"
                rel="noopener noreferrer"
              />
            ),
          }}
        />
      </p>
    </div>
  );
};

/* ── Raspberry Pi 3 Emulation Section ─────────────────── */
const RaspberryPi3EmulationSection: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="docs-section">
      <span className="docs-label">{t('docs.rpi3.label')}</span>
      <h1>{t('docs.rpi3.heading')}</h1>
      <p>
        <Trans i18nKey="docs.rpi3.lead" components={{ strong: <strong />, code: <code /> }} />
      </p>

      <h2>{t('docs.rpi3.boardsHeading')}</h2>
      <div className="docs-board-gallery">
        <div className="docs-board-card">
          <img src="/boards/Raspberry_Pi_3.svg" alt={t('docs.rpi3.altRpi3')} />
          <span>{t('docs.rpi3.boardRpi3')}</span>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>{t('docs.rpi3.thBoard')}</th>
            <th>{t('docs.rpi3.thQemuMachine')}</th>
            <th>{t('docs.rpi3.thCpu')}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{t('docs.rpi3.boardRpi3Name')}</td>
            <td>
              <code>raspi3b</code>
            </td>
            <td>{t('docs.rpi3.cpuBcm')}</td>
          </tr>
        </tbody>
      </table>

      <h2>{t('docs.rpi3.serialHeading')}</h2>
      <p>{t('docs.rpi3.serialLead')}</p>
      <ul>
        <li>
          <Trans
            i18nKey="docs.rpi3.serialUser"
            components={{ strong: <strong />, code: <code /> }}
          />
        </li>
        <li>
          <Trans i18nKey="docs.rpi3.serialGpio" components={{ strong: <strong /> }} />
        </li>
      </ul>

      <h2>{t('docs.rpi3.shimHeading')}</h2>
      <p>
        <Trans
          i18nKey="docs.rpi3.shimBody1"
          components={{ strong: <strong />, code: <code /> }}
        />
      </p>
      <p>
        <Trans i18nKey="docs.rpi3.shimBody2" components={{ code: <code /> }} />
      </p>

      <h2>{t('docs.rpi3.vfsHeading')}</h2>
      <p>{t('docs.rpi3.vfsBody')}</p>
      <CodeBlock language="text">{`/home/pi/
├── script.py     ← user's main Python script
└── lib/
    └── helper.py ← optional helper library`}</CodeBlock>

      <h2>{t('docs.rpi3.overlayHeading')}</h2>
      <p>
        <Trans i18nKey="docs.rpi3.overlayBody" components={{ strong: <strong /> }} />
      </p>

      <h2>{t('docs.rpi3.limitsHeading')}</h2>
      <ul>
        <li>{t('docs.rpi3.limit1')}</li>
        <li>{t('docs.rpi3.limit2')}</li>
        <li>{t('docs.rpi3.limit3')}</li>
        <li>{t('docs.rpi3.limit4')}</li>
        <li>{t('docs.rpi3.limit5')}</li>
        <li>{t('docs.rpi3.limit6')}</li>
      </ul>

      <h2>{t('docs.rpi3.fullDocsHeading')}</h2>
      <p>
        <Trans
          i18nKey="docs.rpi3.fullDocsBody"
          components={{
            a: (
              <a
                href="https://github.com/davidmonterocrespo24/velxio/blob/master/docs/RASPBERRYPI3_EMULATION.md"
                target="_blank"
                rel="noopener noreferrer"
              />
            ),
          }}
        />
      </p>
    </div>
  );
};

/* ── Build QEMU from source ───────────────────────────── */
//
// Transparency section. The Velxio docker image ships with prebuilt
// libqemu-xtensa / libqemu-riscv32 — anyone who'd rather not run
// third-party binaries can rebuild them from lcgamboa/qemu and drop
// them in. Body copy is intentionally hardcoded English: the value
// here is technical clarity and a clean link to the canonical
// docs/BUILD-QEMU.md, not a localised marketing surface.
const BuildQemuSection: React.FC = () => {
  return (
    <div className="docs-section">
      <span className="docs-label">Self-hosting</span>
      <h1>Build QEMU libraries from source</h1>
      <p>
        Velxio ships with prebuilt <code>libqemu-xtensa.so</code> and{' '}
        <code>libqemu-riscv32.so</code> so ESP32 / ESP32-S3 / ESP32-C3
        simulation works the moment you pull the docker image. The
        prebuilts are a convenience — Velxio is <strong>AGPLv3</strong>{' '}
        and so is the QEMU fork it depends on, which means you can
        always rebuild the libraries yourself from source and run
        those instead.
      </p>

      <h2>Why you might want to</h2>
      <ul>
        <li>
          <strong>Audit the supply chain.</strong> Regulated deployments
          often require that every shared object on the box was built
          from a known-good source tree.
        </li>
        <li>
          <strong>Patch QEMU.</strong> Add a peripheral the upstream
          fork doesn't emulate, or backport a fix from mainline QEMU.
        </li>
        <li>
          <strong>You're on an unusual platform.</strong> We currently
          publish Linux x86_64, Linux ARM64, macOS ARM64 and Windows
          x86_64. BSDs, exotic libc, macOS Intel — build your own.
        </li>
        <li>
          <strong>Trust nothing.</strong> A valid reason. Drop our
          binaries, rebuild from sources you've audited, and the
          chain is your tree only.
        </li>
      </ul>

      <h2>The short version</h2>
      <p>
        On a Linux box with a working C toolchain:
      </p>
      <pre><code>{`git clone https://github.com/lcgamboa/qemu.git
cd qemu

# ESP32 (Xtensa)
mkdir build-xtensa && cd build-xtensa
../configure --target-list=xtensa-softmmu --enable-shared-lib \\
             --disable-werror --disable-tools --disable-docs
ninja
# → produces libqemu-xtensa.so (~46 MB)
cd ..

# ESP32-C3 (RISC-V)
mkdir build-riscv32 && cd build-riscv32
../configure --target-list=riscv32-softmmu --enable-shared-lib \\
             --disable-werror --disable-tools --disable-docs
ninja
# → produces libqemu-riscv32.so (~45 MB)`}</code></pre>

      <p>
        Drop both <code>.so</code> files into <code>/app/lib/</code>{' '}
        inside the running Velxio container (or whatever host path you
        bind-mount to it) and restart. The backend dlopens whichever
        library is on disk on the next simulation start, so this
        replaces the shipped binaries cleanly.
      </p>

      <h2>The full guide</h2>
      <p>
        Step-by-step build instructions, dependency lists per OS
        (Debian / Arch / macOS), the canonical commit ID we anchor the
        prebuilts to, troubleshooting for the common configure / ninja
        failures, and the licensing notes (QEMU is GPL-2.0, Velxio is
        AGPLv3, the dlopen boundary keeps them orthogonal) live in the
        full document:
      </p>
      <p>
        <a
          href="https://github.com/davidmonterocrespo24/velxio/blob/master/docs/BUILD-QEMU.md"
          target="_blank"
          rel="noopener noreferrer"
        >
          Read <code>docs/BUILD-QEMU.md</code> on GitHub →
        </a>
      </p>

      <h2>Or use the prebuilts</h2>
      <p>
        If you don't have a 15-30 minute build in you, the
        sha256-pinned prebuilts are available at{' '}
        <a
          href="https://velxio.dev/license/signup"
          target="_blank"
          rel="noopener noreferrer"
        >
          velxio.dev/license/signup
        </a>{' '}
        (free personal-use key, takes a minute), and the existing
        public release at <code>github.com/davidmonterocrespo24/velxio
        /releases/tag/qemu-prebuilt</code> still serves the same files
        byte-for-byte. Both produce identical libraries to what this
        guide builds — there's no "blessed" version, just convenience
        choices.
      </p>
    </div>
  );
};

const SECTION_MAP: Record<SectionId, React.FC> = {
  intro: IntroSection,
  'getting-started': GettingStartedSection,
  emulator: EmulatorSection,
  'riscv-emulation': RiscVEmulationSection,
  'esp32-emulation': Esp32EmulationSection,
  'rp2040-emulation': Rp2040EmulationSection,
  'raspberry-pi3-emulation': RaspberryPi3EmulationSection,
  components: ComponentsSection,
  roadmap: RoadmapSection,
  architecture: ArchitectureSection,
  'third-party': WokwiLibsSection,
  mcp: McpSection,
  setup: SetupSection,
  'build-qemu': BuildQemuSection,
};

/* ── Page ─────────────────────────────────────────────── */
export const DocsPage: React.FC = () => {
  const { section } = useParams<{ section?: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const localize = useLocalizedHref();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Derive active section from URL; fall back to 'intro'
  const activeSection: SectionId =
    section && VALID_SECTIONS.includes(section as SectionId) ? (section as SectionId) : 'intro';

  // Redirect bare /docs → /docs/intro so every section has a canonical URL
  useEffect(() => {
    if (!section) {
      navigate(localize('/docs/intro'), { replace: true });
    }
  }, [section, navigate, localize]);

  // Capture the original <head> values once on mount and restore them on unmount
  useEffect(() => {
    const origTitle = document.title;

    // Helper to capture an element and its original attribute value
    const captureAttr = <E extends Element>(selector: string, attr: string): [E | null, string] => {
      const el = document.querySelector<E>(selector);
      return [el, el?.getAttribute(attr) ?? ''];
    };

    const [descEl, origDesc] = captureAttr<HTMLMetaElement>('meta[name="description"]', 'content');
    const [canonicalEl, origCanonical] = captureAttr<HTMLLinkElement>(
      'link[rel="canonical"]',
      'href',
    );
    const [ogTitleEl, origOgTitle] = captureAttr<HTMLMetaElement>(
      'meta[property="og:title"]',
      'content',
    );
    const [ogDescEl, origOgDesc] = captureAttr<HTMLMetaElement>(
      'meta[property="og:description"]',
      'content',
    );
    const [ogUrlEl, origOgUrl] = captureAttr<HTMLMetaElement>('meta[property="og:url"]', 'content');
    const [twTitleEl, origTwTitle] = captureAttr<HTMLMetaElement>(
      'meta[name="twitter:title"]',
      'content',
    );
    const [twDescEl, origTwDesc] = captureAttr<HTMLMetaElement>(
      'meta[name="twitter:description"]',
      'content',
    );

    return () => {
      document.title = origTitle;
      descEl?.setAttribute('content', origDesc);
      canonicalEl?.setAttribute('href', origCanonical);
      ogTitleEl?.setAttribute('content', origOgTitle);
      ogDescEl?.setAttribute('content', origOgDesc);
      ogUrlEl?.setAttribute('content', origOgUrl);
      twTitleEl?.setAttribute('content', origTwTitle);
      twDescEl?.setAttribute('content', origTwDesc);
      document.getElementById('docs-jsonld')?.remove();
    };
  }, []); // runs once on mount; cleanup runs once on unmount

  // Update all head metadata + JSON-LD per section.
  // No cleanup here — the mount effect above restores defaults on unmount,
  // and on a section change the next run of this effect immediately overwrites.
  useEffect(() => {
    const meta = SECTION_META[activeSection];
    const title = t(meta.titleKey);
    const description = t(meta.descriptionKey);
    const pageUrl = `${BASE_URL}/docs/${activeSection}`;

    document.title = title;

    const set = (selector: string, value: string) =>
      document.querySelector<HTMLMetaElement>(selector)?.setAttribute('content', value);

    set('meta[name="description"]', description);
    set('meta[property="og:title"]', title);
    set('meta[property="og:description"]', description);
    set('meta[property="og:url"]', pageUrl);
    set('meta[name="twitter:title"]', title);
    set('meta[name="twitter:description"]', description);

    const canonicalEl = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (canonicalEl) canonicalEl.setAttribute('href', pageUrl);

    // Build the breadcrumb section label for JSON-LD
    const activeNav = NAV_ITEMS.find((i) => i.id === activeSection);
    const sectionLabel = activeNav ? t(activeNav.labelKey) : activeSection;

    // Inject / update JSON-LD structured data for this doc page
    const ldId = 'docs-jsonld';
    let ldScript = document.getElementById(ldId) as HTMLScriptElement | null;
    if (!ldScript) {
      ldScript = document.createElement('script');
      ldScript.id = ldId;
      ldScript.type = 'application/ld+json';
      document.head.appendChild(ldScript);
    }
    ldScript.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'TechArticle',
          headline: title,
          description: description,
          url: pageUrl,
          isPartOf: { '@type': 'WebSite', url: `${BASE_URL}/`, name: 'Velxio' },
          inLanguage: 'en-US',
          author: AUTHOR,
        },
        {
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home', item: `${BASE_URL}/` },
            {
              '@type': 'ListItem',
              position: 2,
              name: 'Documentation',
              item: `${BASE_URL}/docs/intro`,
            },
            { '@type': 'ListItem', position: 3, name: sectionLabel, item: pageUrl },
          ],
        },
      ],
    });
  }, [activeSection, t]);

  const ActiveContent = SECTION_MAP[activeSection];
  const activeIdx = NAV_ITEMS.findIndex((i) => i.id === activeSection);

  return (
    <div className="docs-page">
      <AppHeader />
      <div className="docs-mobile-bar">
        <button
          className="docs-sidebar-toggle"
          onClick={() => setSidebarOpen((v) => !v)}
          aria-label={t('docs.toggleSidebar')}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <span className="docs-mobile-bar-title">{t('docs.pageTitle')}</span>
      </div>

      <div className="docs-body">
        {/* Sidebar */}
        <aside className={`docs-sidebar${sidebarOpen ? ' docs-sidebar--open' : ''}`}>
          <div className="docs-sidebar-title">{t('docs.pageTitle')}</div>
          <nav className="docs-sidebar-nav">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.id}
                to={localize(`/docs/${item.id}`)}
                className={`docs-sidebar-item${activeSection === item.id ? ' docs-sidebar-item--active' : ''}`}
                onClick={() => setSidebarOpen(false)}
              >
                {t(item.labelKey)}
              </Link>
            ))}
          </nav>
          <div className="docs-sidebar-divider" />
          <div className="docs-sidebar-title docs-sidebar-title--pages">{t('docs.pages')}</div>
          <nav className="docs-sidebar-nav">
            <Link
              to={localize('/')}
              className="docs-sidebar-item docs-sidebar-link"
              onClick={() => setSidebarOpen(false)}
            >
              {t('docs.pagesNav.home')}
            </Link>
            <Link
              to={localize('/editor')}
              className="docs-sidebar-item docs-sidebar-link"
              onClick={() => setSidebarOpen(false)}
            >
              {t('docs.pagesNav.editor')}
            </Link>
            <Link
              to={localize('/examples')}
              className="docs-sidebar-item docs-sidebar-link"
              onClick={() => setSidebarOpen(false)}
            >
              {t('docs.pagesNav.examples')}
            </Link>
          </nav>
          <div className="docs-sidebar-footer">
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="docs-sidebar-gh"
            >
              <IcoGitHub /> {t('docs.viewOnGitHub')}
            </a>
          </div>
        </aside>

        {/* Main content */}
        <main className="docs-main">
          <ActiveContent />

          {/* Prev / Next navigation */}
          <div className="docs-pagination">
            {activeIdx > 0 && (
              <Link
                to={localize(`/docs/${NAV_ITEMS[activeIdx - 1].id}`)}
                className="docs-pagination-btn docs-pagination-btn--prev"
                onClick={() => window.scrollTo(0, 0)}
              >
                ← {t(NAV_ITEMS[activeIdx - 1].labelKey)}
              </Link>
            )}
            {activeIdx < NAV_ITEMS.length - 1 && (
              <Link
                to={localize(`/docs/${NAV_ITEMS[activeIdx + 1].id}`)}
                className="docs-pagination-btn docs-pagination-btn--next"
                onClick={() => window.scrollTo(0, 0)}
              >
                {t(NAV_ITEMS[activeIdx + 1].labelKey)} →
              </Link>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};
