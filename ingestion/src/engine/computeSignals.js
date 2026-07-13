/**
 * Signal computation — ingestion seam.
 *
 * These functions (estimateAUM, computeTurnover, assetMix, inferSegment,
 * matchNameSignals, deriveAdvSegment, computePassesICP) are pure and now live in
 * shared/engine/computeSignals.js — a single source imported by both this
 * pipeline and the Vite frontend (Config UI preview). This module is a pure
 * re-export; existing consumers import from ./computeSignals.js unchanged.
 */
export * from '../../../shared/engine/computeSignals.js';
