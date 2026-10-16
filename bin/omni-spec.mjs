#!/usr/bin/env node

/**
 * OmniSpec CLI Entrypoint
 * Universal Spec-Driven Development Framework
 */

import { runCli } from '../src/cli.mjs';

runCli(process.argv.slice(2))
  .then((exitCode) => {
    process.exit(exitCode ?? 0);
  })
  .catch((err) => {
    console.error('Fatal OmniSpec error:', err);
    process.exit(1);
  });
