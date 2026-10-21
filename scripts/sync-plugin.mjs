import { installPlugin } from '../src/plugin-manager.mjs';

try {
  const result = await installPlugin();
  console.log(`[SUCCESS] OmniSpec Antigravity plugin synced successfully at: ${result.targetDir}`);
  console.log(`[NOTE] In Antigravity, the plugin is active immediately for new prompts, or run /plugin to inspect.`);
} catch (err) {
  console.error(`[ERROR] Failed to sync plugin: ${err.message}`);
  process.exit(1);
}
