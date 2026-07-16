/**
 * CustomChipDialog — modal for editing/compiling a Velxio custom chip.
 *
 * Two tabs:
 *   - "Examples": gallery of pre-built chips. Click → loads the source.
 *   - "Editor":   Monaco editors for chip.c and chip.json + Compile button +
 *                 stdout/stderr panel + Save button.
 *
 * The Save action persists the compiled WASM (base64) into the component's
 * `properties` so the chip is fully self-contained inside the project.
 */
import { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import Editor from '@monaco-editor/react';
import { CHIP_EXAMPLES, BLANK_CHIP, type ChipExample } from './chipExamples';
import { compileChip, type ChipCompileResult } from '../../services/chipCompileService';

export interface CustomChipDialogProps {
  /** Initial chip data (from component.properties). */
  initial: {
    chipName: string;
    sourceC: string;
    chipJson: string;
    wasmBase64: string;
    attrs?: Record<string, number>;
  };
  onClose: () => void;
  onSave: (data: {
    chipName: string;
    sourceC: string;
    chipJson: string;
    wasmBase64: string;
    attrs: Record<string, number>;
  }) => void;
}

interface AttributeDef {
  name: string;
  label?: string;
  type?: 'int' | 'float' | 'number';
  default?: number;
  min?: number;
  max?: number;
  step?: number;
}

function parseAttributes(chipJson: string): AttributeDef[] {
  try {
    const obj = JSON.parse(chipJson);
    if (Array.isArray(obj.attributes)) {
      return obj.attributes.map((a: any): AttributeDef => ({
        name: String(a.name ?? ''),
        label: typeof a.label === 'string' ? a.label : undefined,
        type: a.type === 'float' || a.type === 'int' ? a.type : 'number',
        default: typeof a.default === 'number' ? a.default : undefined,
        min: typeof a.min === 'number' ? a.min : undefined,
        max: typeof a.max === 'number' ? a.max : undefined,
        step: typeof a.step === 'number' ? a.step : undefined,
      })).filter((a: AttributeDef) => a.name);
    }
  } catch { /* ignore */ }
  return [];
}

type Tab = 'examples' | 'editor';

// Placeholder chip names that are treated as "not user-named" — chip.json's
// `name` may seed over any of these. 'My Chip' is the dialog default; 'Custom
// Chip' is the file-explorer empty-rename fallback. Keep both in sync here.
const BLANK_CHIP_NAMES = new Set(['', 'My Chip', 'Custom Chip']);

export const CustomChipDialog = ({ initial, onClose, onSave }: CustomChipDialogProps) => {
  const { t } = useTranslation();
  // If the chip already has source code, skip the examples tab on open.
  const [tab, setTab] = useState<Tab>(initial.sourceC.trim() ? 'editor' : 'examples');
  const [chipName, setChipName] = useState(initial.chipName || 'My Chip');
  const [sourceC, setSourceC] = useState(initial.sourceC || BLANK_CHIP.sourceC);
  const [chipJson, setChipJson] = useState(initial.chipJson || BLANK_CHIP.chipJson);
  const [wasmBase64, setWasmBase64] = useState(initial.wasmBase64 || '');

  const [compiling, setCompiling] = useState(false);
  const [result, setResult] = useState<ChipCompileResult | null>(null);
  const [attrs, setAttrs] = useState<Record<string, number>>(initial.attrs ?? {});

  const attrDefs = useMemo(() => parseAttributes(chipJson), [chipJson]);

  // When attribute defs change (e.g. user loaded a new example), seed defaults
  // for any newly-introduced attribute that doesn't have a saved value yet.
  useEffect(() => {
    setAttrs((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const a of attrDefs) {
        if (!(a.name in next) && a.default !== undefined) {
          next[a.name] = a.default;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [attrDefs]);

  // Categories shown as section headers in the gallery.
  const grouped = useMemo(() => {
    const m = new Map<string, ChipExample[]>();
    for (const e of CHIP_EXAMPLES) {
      if (!m.has(e.category)) m.set(e.category, []);
      m.get(e.category)!.push(e);
    }
    return Array.from(m.entries());
  }, []);

  // Seed chipName from chip.json's `name` ONLY while the chip still has a
  // blank default name — so editing chip.json names a fresh chip, but a name
  // the user gave it (renamed in the file explorer) is NOT clobbered. The
  // display name lives in properties.chipName and wins; chip.json `name` is
  // just the initial seed. (Switching examples relabels explicitly in
  // loadExample.) Both blank defaults are recognised so neither sticks.
  useEffect(() => {
    setChipName((prev) => {
      if (prev && prev.trim() && !BLANK_CHIP_NAMES.has(prev.trim())) return prev;
      try {
        const obj = JSON.parse(chipJson);
        if (obj && typeof obj.name === 'string' && obj.name.trim()) return obj.name;
      } catch { /* user is mid-edit, ignore */ }
      return prev;
    });
  }, [chipJson]);

  const loadExample = (e: ChipExample) => {
    setSourceC(e.sourceC);
    setChipJson(e.chipJson);
    // Loading an example is an explicit "use this chip" — relabel from its
    // chip.json name even over a previously-loaded example's name.
    try {
      const obj = JSON.parse(e.chipJson);
      if (obj && typeof obj.name === 'string' && obj.name.trim()) setChipName(obj.name);
    } catch { /* keep current name */ }
    setWasmBase64('');     // force re-compile so the binary matches the loaded source
    setResult(null);
    setTab('editor');
  };

  const doCompile = async () => {
    setCompiling(true);
    setResult(null);
    try {
      const r = await compileChip(sourceC, chipJson);
      setResult(r);
      if (r.success && r.wasm_base64) setWasmBase64(r.wasm_base64);
    } finally {
      setCompiling(false);
    }
  };

  const canSave = wasmBase64.length > 0;
  const doSave = () => {
    if (!canSave) return;
    onSave({ chipName, sourceC, chipJson, wasmBase64, attrs });
  };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={dialogStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headerStyle}>
          <strong style={{ flex: 1 }}>{t('editor.customChip.title', { chipName })}</strong>
          <button style={closeBtn} onClick={onClose}>✕</button>
        </div>

        <div style={tabsRowStyle}>
          <button
            style={{ ...tabBtn, ...(tab === 'examples' ? tabActive : null) }}
            onClick={() => setTab('examples')}
          >
            {t('editor.customChip.tabExamples')}
          </button>
          <button
            style={{ ...tabBtn, ...(tab === 'editor' ? tabActive : null) }}
            onClick={() => setTab('editor')}
          >
            {t('editor.customChip.tabEditor')}
          </button>
        </div>

        <div style={bodyStyle}>
          {tab === 'examples' && (
            <div style={{ overflow: 'auto', padding: 12 }}>
              <button style={blankBtn} onClick={() => loadExample(BLANK_CHIP)}>
                + Start from blank
              </button>
              {grouped.map(([cat, list]) => (
                <div key={cat} style={{ marginTop: 18 }}>
                  <div style={categoryStyle}>{cat.toUpperCase()}</div>
                  <div style={gridStyle}>
                    {list.map((ex) => (
                      <button
                        key={ex.id}
                        style={cardBtn}
                        onClick={() => loadExample(ex)}
                        title={ex.description}
                      >
                        <div style={cardName}>{ex.name}</div>
                        <div style={cardDesc}>{ex.description}</div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'editor' && (
            <div style={editorLayout}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <div style={editorLabel}>chip.c</div>
                <div style={{ flex: 1 }}>
                  <Editor
                    height="100%"
                    language="cpp"
                    theme="vs-dark"
                    value={sourceC}
                    onChange={(v) => { setSourceC(v ?? ''); setWasmBase64(''); }}
                    options={{
                      minimap: { enabled: false },
                      fontSize: 12,
                      automaticLayout: true,
                      scrollBeyondLastLine: false,
                    }}
                  />
                </div>
              </div>
              <div style={{ width: 360, display: 'flex', flexDirection: 'column' }}>
                <div style={editorLabel}>chip.json</div>
                <div style={{ flex: 1, minHeight: 200 }}>
                  <Editor
                    height="100%"
                    language="json"
                    theme="vs-dark"
                    value={chipJson}
                    onChange={(v) => setChipJson(v ?? '')}
                    options={{
                      minimap: { enabled: false },
                      fontSize: 12,
                      automaticLayout: true,
                    }}
                  />
                </div>
                {attrDefs.length > 0 && (
                  <div style={attrPanelStyle}>
                    <div style={attrPanelHeader}>{t('editor.customChip.attributes')}</div>
                    {attrDefs.map((a) => (
                      <AttrRow
                        key={a.name}
                        def={a}
                        value={attrs[a.name] ?? a.default ?? 0}
                        onChange={(v) => setAttrs((prev) => ({ ...prev, [a.name]: v }))}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {tab === 'editor' && (
          <div style={resultPanelStyle}>
            {compiling && <span style={{ color: '#ffa500' }}>{t('editor.customChip.compiling')}</span>}
            {!compiling && result && result.success && (
              <span style={{ color: '#22c55e' }}>
                {t('editor.customChip.compiledOk', { kb: (result.byte_size / 1024).toFixed(1) })}
              </span>
            )}
            {!compiling && result && !result.success && (
              <pre style={errorPreStyle}>{result.error || t('editor.customChip.compileFailed')}{'\n'}{result.stderr}</pre>
            )}
          </div>
        )}

        <div style={footerStyle}>
          {tab === 'editor' && (
            <button style={compileBtn} onClick={doCompile} disabled={compiling}>
              {compiling ? t('editor.customChip.compiling') : t('editor.customChip.compile')}
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button style={cancelBtn} onClick={onClose}>{t('editor.customChip.cancel')}</button>
          <button style={canSave ? saveBtn : saveBtnDisabled} disabled={!canSave} onClick={doSave}>
            {canSave ? t('editor.customChip.savePlace') : t('editor.customChip.compileFirst')}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Inline styles (matches the visual language of other Velxio modals) ──

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
  zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center',
};
const dialogStyle: React.CSSProperties = {
  width: '90vw', height: '85vh', maxWidth: 1280,
  background: '#1f1f1f', color: '#e0e0e0', borderRadius: 6,
  display: 'flex', flexDirection: 'column',
  boxShadow: '0 12px 36px rgba(0,0,0,0.5)',
};
const headerStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', padding: '10px 14px',
  borderBottom: '1px solid #333', background: '#252526',
};
const closeBtn: React.CSSProperties = {
  background: 'transparent', border: 'none', color: '#999',
  fontSize: 18, cursor: 'pointer', padding: '2px 8px',
};
const tabsRowStyle: React.CSSProperties = {
  display: 'flex', gap: 4, padding: '6px 12px 0',
  borderBottom: '1px solid #333', background: '#252526',
};
const tabBtn: React.CSSProperties = {
  padding: '6px 14px', background: 'transparent', color: '#999',
  border: 'none', borderBottom: '2px solid transparent',
  cursor: 'pointer', fontSize: 13,
};
const tabActive: React.CSSProperties = { color: '#e0e0e0', borderBottom: '2px solid #007acc' };
const bodyStyle: React.CSSProperties = { flex: 1, overflow: 'hidden', display: 'flex' };
const editorLayout: React.CSSProperties = {
  display: 'flex', flex: 1, gap: 8, padding: 8, overflow: 'hidden',
};
const editorLabel: React.CSSProperties = {
  padding: '4px 8px', fontSize: 11, color: '#888',
  background: '#252526', borderTopLeftRadius: 4, borderTopRightRadius: 4,
};
const resultPanelStyle: React.CSSProperties = {
  borderTop: '1px solid #333', padding: '6px 14px',
  fontSize: 12, fontFamily: 'monospace', maxHeight: 120, overflow: 'auto',
};
const errorPreStyle: React.CSSProperties = {
  margin: 0, color: '#f87171', whiteSpace: 'pre-wrap', fontSize: 11,
};
const footerStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
  borderTop: '1px solid #333', background: '#252526',
};
const compileBtn: React.CSSProperties = {
  padding: '6px 14px', background: '#007acc', color: 'white',
  border: 'none', borderRadius: 3, cursor: 'pointer', fontSize: 13,
};
const cancelBtn: React.CSSProperties = {
  padding: '6px 14px', background: '#3a3a3a', color: '#e0e0e0',
  border: 'none', borderRadius: 3, cursor: 'pointer', fontSize: 13,
};
const saveBtn: React.CSSProperties = {
  padding: '6px 14px', background: '#22c55e', color: 'white',
  border: 'none', borderRadius: 3, cursor: 'pointer', fontSize: 13,
};
const saveBtnDisabled: React.CSSProperties = { ...saveBtn, background: '#3a3a3a', cursor: 'not-allowed' };
const blankBtn: React.CSSProperties = {
  padding: '8px 14px', background: '#2d2d30', color: '#e0e0e0',
  border: '1px dashed #555', borderRadius: 4, cursor: 'pointer',
  width: '100%', textAlign: 'left', fontSize: 13,
};
const categoryStyle: React.CSSProperties = {
  fontSize: 10, color: '#888', letterSpacing: 1, marginBottom: 6,
};
const gridStyle: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8,
};
const cardBtn: React.CSSProperties = {
  padding: '10px 12px', background: '#2d2d30', color: '#e0e0e0',
  border: '1px solid #3a3a3a', borderRadius: 4, cursor: 'pointer',
  textAlign: 'left',
};
const cardName: React.CSSProperties = { fontSize: 13, fontWeight: 'bold', marginBottom: 4 };
const cardDesc: React.CSSProperties = { fontSize: 11, color: '#999', lineHeight: 1.4 };
const attrPanelStyle: React.CSSProperties = {
  marginTop: 8, padding: '8px 10px', background: '#252526',
  borderRadius: 4, maxHeight: 220, overflow: 'auto',
};
const attrPanelHeader: React.CSSProperties = {
  fontSize: 10, color: '#888', letterSpacing: 1, marginBottom: 6, textTransform: 'uppercase',
};

function AttrRow({
  def,
  value,
  onChange,
}: {
  def: AttributeDef;
  value: number;
  onChange: (v: number) => void;
}) {
  const isInt = def.type === 'int';
  const min = def.min;
  const max = def.max;
  const step = def.step ?? (isInt ? 1 : 0.01);
  const showSlider = min !== undefined && max !== undefined;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <label style={{ flex: '0 0 96px', fontSize: 11, color: '#bbb' }}>{def.label || def.name}</label>
      {showSlider && (
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            onChange(isInt ? Math.round(v) : v);
          }}
          style={{ flex: 1 }}
        />
      )}
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (!Number.isFinite(v)) return;
          onChange(isInt ? Math.round(v) : v);
        }}
        style={{
          width: 76, padding: '2px 4px', fontSize: 11,
          background: '#1f1f1f', color: '#e0e0e0',
          border: '1px solid #444', borderRadius: 2,
        }}
      />
    </div>
  );
}
