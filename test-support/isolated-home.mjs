import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Test runs keep OmniSpec's per-user state (attestation key, auth store) out of the real
// %LOCALAPPDATA%\OmniSpec or ~/.local/state/omnispec. Child processes inherit the variable.
if (!process.env.OMNISPEC_HOME) process.env.OMNISPEC_HOME = join(tmpdir(), 'omnispec-test-home');
