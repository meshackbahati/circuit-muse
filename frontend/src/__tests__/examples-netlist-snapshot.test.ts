/**
 * Netlist snapshot tests (Phase 1d-tests A).
 *
 * For every example across ALL `examples-*.ts` modules, build the
 * SPICE netlist via the production pipeline and snapshot the FULL
 * netlist string.  If a refactor changes how `componentToSpice`,
 * `NetlistBuilder`, or `storeAdapter` emit cards, the diff lands in
 * `__snapshots__/examples-netlist-snapshot.test.ts.snap` and a
 * reviewer sees exactly what changed across every example.
 *
 * To intentionally update the snapshots after a legitimate model
 * change:
 *
 *   npx vitest run -u src/__tests__/examples-netlist-snapshot.test.ts
 *
 * The PR diff of the snapshot file becomes the evidence of which
 * circuits are affected.
 *
 * Test fidelity rule (memory `feedback_tests_import_real_code`):
 * imports the example arrays directly from the source modules and
 * uses the same `exampleToBuildNetlistInput` that production
 * `loadExample.ts` uses.  Nothing is duplicated.
 */
import { describe, it, expect } from 'vitest';
import { analogExamples } from '../data/examples-analog';
import { digitalExamples } from '../data/examples-digital';
import { hundredDaysExamples } from '../data/examples-100-days';
import { epaperExamples } from '../data/examples-displays-epaper';
import { picowWifiExamples } from '../data/examples-picow-wifi';
import { circuitExamples } from '../data/examples-circuits';
import { exampleToBuildNetlistInput } from '../utils/exampleToBuildNetlistInput';
import { buildNetlist } from '../simulation/spice/NetlistBuilder';
import type { ExampleProject } from '../data/examples';

/**
 * Normalise the netlist before snapshotting:
 *   - strip the leading `* Velxio circuit @ <ISO timestamp>` comment
 *     (timestamp would flake every run)
 *
 * Everything else is verbatim — model lines, source ordering, etc.
 */
function snapshotNetlist(netlist: string): string {
  return netlist.replace(/^\* Velxio circuit @[^\n]*\n/, '* Velxio circuit\n');
}

function snapshotExample(example: ExampleProject): string {
  // Some examples have no electrical components (firmware-only).  The
  // builder still produces a minimal netlist with the analysis card +
  // `.end`; snapshot that for completeness.
  const input = exampleToBuildNetlistInput(example);
  const { netlist } = buildNetlist(input);
  return snapshotNetlist(netlist);
}

interface Bucket {
  name: string;
  examples: ExampleProject[];
}

const BUCKETS: Bucket[] = [
  { name: 'analog', examples: analogExamples },
  { name: 'digital', examples: digitalExamples },
  { name: '100-days', examples: hundredDaysExamples },
  { name: 'epaper', examples: epaperExamples },
  { name: 'picow-wifi', examples: picowWifiExamples },
  { name: 'circuits', examples: circuitExamples },
];

for (const bucket of BUCKETS) {
  describe(`netlist snapshot — ${bucket.name} (${bucket.examples.length} examples)`, () => {
    it.each(bucket.examples.map((ex) => [ex.id, ex] as const))(
      '%s',
      { timeout: 5_000 },
      (_id, example) => {
        const netlist = snapshotExample(example);
        expect(netlist).toMatchSnapshot();
      },
    );
  });
}
