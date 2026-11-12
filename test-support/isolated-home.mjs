import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Test runs keep OmniSpec's per-user state (attestation key, auth store) and plugin discovery
// out of the real %LOCALAPPDATA%\OmniSpec, ~/.local/state/omnispec, or ~/.gemini/config/plugins.
// Child processes inherit the variables unless explicitly overridden by the test.
const testHome = process.env.OMNISPEC_HOME || join(tmpdir(), 'omnispec-test-home');
process.env.OMNISPEC_HOME = testHome;
process.env.HOME = testHome;
process.env.USERPROFILE = testHome;
