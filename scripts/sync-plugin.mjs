import { symlink, mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const targetDir = join(homedir(), '.gemini', 'config', 'plugins', 'omni-spec');
const sourceDir = process.cwd();

console.log(`[SYNC] Linking ${sourceDir} -> ${targetDir}...`);

try {
  await mkdir(join(homedir(), '.gemini', 'config', 'plugins'), { recursive: true });
  
  try {
    const existing = await stat(targetDir);
    if (existing) {
      await rm(targetDir, { recursive: true, force: true });
    }
  } catch {}

  // Use directory junction on Windows, dir symlink on POSIX
  const type = process.platform === 'win32' ? 'junction' : 'dir';
  await symlink(sourceDir, targetDir, type);
  console.log(`[SUCCESS] OmniSpec Antigravity plugin linked successfully at: ${targetDir}`);
  console.log(`[NOTE] In Antigravity, restart the IDE or use /plugin to view and manage omni-spec.`);
} catch (err) {
  console.error(`[ERROR] Failed to link plugin: ${err.message}`);
  process.exit(1);
}
