#!/usr/bin/env bun
/**
 * Submit a run bundle to the shared QuestBench dataset.   (NOT IMPLEMENTED in v0.1)
 *
 * Planned flow (DESIGN.md, "Community runs and shared telemetry"):
 *   1. require `tools/redact-bundle.ts` to have run (marker file) and show the contributor a summary
 *   2. run ingest/verify-bundle.ts locally so obviously broken bundles never upload
 *   3. sign in with GitHub or Discord (device flow) for attribution; accept the data licence once
 *   4. request a short-lived signed upload URL from the ingest API, upload run-<uuid>.tar.zst
 *   5. print the run's public URL and its trust tier once ingest finishes
 *
 * Storage and hosting choices are an open decision (see README "Open decisions").
 */
console.error('submit is not implemented yet. For now, share bundles by opening a GitHub issue with the bundle attached.');
process.exit(1);
