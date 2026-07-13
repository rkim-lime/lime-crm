import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// These imports are resolved + transformed by the VITE toolchain (vitest uses
// Vite's resolver). If shared/engine ever pulled a Node-only or service-key module
// into the browser graph, this import chain — and the guard below — fail loudly.
import { inferSegment, deriveAdvSegment } from '../../shared/engine/computeSignals.js';
import { deriveRelevanceVerdict } from '../../shared/engine/assetClass.js';
import { computeFitScore } from '../../shared/engine/fitScore.js';
import { cases } from '../../shared/engine/__fixtures__/parityCases.js';

// Parity — FRONTEND side. Same shared functions + same golden fixtures as
// ingestion/tests/parity.test.js. Both suites green ⇒ provable behavioral parity.
const FNS = { inferSegment, deriveAdvSegment, computeFitScore, deriveRelevanceVerdict };

describe('shared/engine parity (real DB config) — frontend/Vite', () => {
  for (const c of cases) {
    it(`${c.fn}: ${c.label}`, () => {
      expect(FNS[c.fn](...c.args)).toEqual(c.expected);
    });
  }
});

// ── Browser-safety guard ──────────────────────────────────────────────────────
// The real risk of a shared module: someone adds an import that's fine in Node but
// poisons the browser bundle (a node: builtin, the service-key supabaseClient, a
// process.env read, or a '../' import escaping shared/engine into ingestion). This
// statically inspects every shared/engine source and fails the FRONTEND suite the
// moment such an import appears — before it can reach a user's bundle.
const here = dirname(fileURLToPath(import.meta.url));
const engineDir = join(here, '../../shared/engine');

function engineFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? engineFiles(join(dir, e.name))
      : e.name.endsWith('.js') ? [join(dir, e.name)] : [],
  );
}

describe('shared/engine is browser-safe (no Node/service-key leak)', () => {
  const files = engineFiles(engineDir);

  it('scans every shared/engine source file', () => {
    expect(files.length).toBeGreaterThanOrEqual(4); // computeSignals, assetClass, fitScore, fixtures
  });

  for (const file of engineFiles(engineDir)) {
    const rel = file.slice(engineDir.length + 1);
    const src = readFileSync(file, 'utf8');

    it(`${rel}: imports only sibling shared modules`, () => {
      const specifiers = [...src.matchAll(/(?:import|export)[^'"]*from\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
      for (const spec of specifiers) {
        // Only './'-relative siblings are allowed. '../' escapes shared/engine; a
        // bare specifier is an npm/Node module; both are browser-bundle risks here.
        expect(spec, `${rel} imports "${spec}"`).toMatch(/^\.\//);
      }
    });

    it(`${rel}: no node:/service-key/process.env references`, () => {
      expect(src, `${rel} references a Node builtin`).not.toMatch(/from\s*['"]node:/);
      expect(src, `${rel} references supabase`).not.toMatch(/supabaseClient|@supabase|createClient/);
      expect(src, `${rel} reads process.env`).not.toMatch(/process\.env/);
      expect(src, `${rel} uses require()`).not.toMatch(/\brequire\s*\(/);
    });
  }
});
