import { scaffoldProject, createSpec, ARCHETYPES } from './generator.mjs';
import { runWizard } from './wizard.mjs';
import { loadManifest, updateSpecStatus, getActiveSpec } from './manifest.mjs';
import { auditSpec } from './auditor.mjs';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function getVersion() {
  try {
    const pkgPath = join(__dirname, '..', 'package.json');
    const raw = await readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw);
    return pkg.version;
  } catch {
    return '0.3.0';
  }
}

export function printHelp() {
  console.log(`
OmniSpec — Universal Spec-Driven Development Framework (v0.3.0)

USAGE:
  omni-spec <command> [options]

COMMANDS:
  init                     Initialize OmniSpec in the current repository with interactive wizard
  create <type> <name>     Create a new specification (feature, bugfix, debt, rfc)
  audit [id]               Audit specification health, Phase 0 gates, and task progress
  status                   Show the current active spec and project progress
  complete <id>            Mark a specification as completed
  help                     Show this help message
  version                  Show OmniSpec version

TYPES FOR "create":
  feature                  New user-facing capability (spec.md, plan.md, tasks.md)
  bugfix                   Defect or runtime error RCA (bug.md, rca.md, fix.md)
  debt                     Technical debt / refactor (audit.md, migration-plan.md, tasks.md)
  rfc                      Architectural decision record / proposal (rfc.md)

OPTIONS FOR "init":
  --yes, -y                Use automatic defaults without interactive prompt
  --profile <name>         Preselect domain profile (general, fintech, healthtech, bpo, ecommerce)
  --name <projectName>     Specify project name
  --stack <techStack>      Specify tech stack
  --doc <standard>         Specify documentation standard (JSDoc, TSDoc, JavaDoc, etc.)

EXAMPLES:
  omni-spec init
  omni-spec init --yes --profile fintech
  omni-spec create feature user-authentication
  omni-spec create bugfix null-pointer-dashboard
  omni-spec create debt remove-legacy-mock
  omni-spec create rfc websocket-vs-sse
  omni-spec audit
  omni-spec audit 001
  omni-spec status
  omni-spec complete 001
`);
}

export async function runCli(args = process.argv.slice(2), workingDir = process.cwd()) {
  const command = args[0];

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return 0;
  }

  if (command === 'version' || command === '--version' || command === '-v') {
    const version = await getVersion();
    console.log(`omni-spec v${version}`);
    return 0;
  }

  // Parse simple flags
  const flags = {};
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--yes' || arg === '-y') flags.yes = true;
    else if (arg === '--profile' && args[i + 1]) flags.profile = args[++i];
    else if (arg === '--name' && args[i + 1]) flags.name = args[++i];
    else if (arg === '--stack' && args[i + 1]) flags.stack = args[++i];
    else if (arg === '--doc' && args[i + 1]) flags.doc = args[++i];
  }

  try {
    switch (command) {
      case 'init': {
        const wizardOptions = await runWizard(workingDir, flags);
        console.log('[INFO] Scaffolding OmniSpec files...');
        const result = await scaffoldProject(workingDir, wizardOptions);
        console.log('[OK] OmniSpec initialized successfully!');
        console.log(`   - Constitution:  ${result.constitutionPath}`);
        console.log(`   - Specs folder:  ${result.specsDir}`);
        console.log(`   - Manifest:      ${result.manifestPath}\n`);
        console.log('Next step: create your first spec with:');
        console.log('  omni-spec create feature <feature-name>\n');
        return 0;
      }

      case 'create': {
        const type = args[1];
        const name = args[2];
        if (!type || !name) {
          console.error('[ERROR] Both archetype type and name are required.');
          console.log('Usage: omni-spec create <feature|bugfix|debt|rfc> <name>');
          return 1;
        }

        console.log(`[CREATE] Creating new ${type} spec: "${name}"...`);
        const spec = await createSpec(workingDir, type, name, flags);
        console.log(`[OK] Spec created at: specs/${spec.slug}`);
        console.log(`   - Archetype:  ${spec.archetype}`);
        console.log(`   - Git Branch: ${spec.branch}`);
        console.log(`   - Status:     Active\n`);
        console.log(`Open specs/${spec.slug} to complete the specification.`);
        return 0;
      }

      case 'audit': {
        const id = args[1] || null;
        console.log('[AUDIT] Running specification health audit...');
        const report = await auditSpec(workingDir, id);

        if (!report.spec) {
          console.error(`[ERROR] ${report.errors.join(' ')}`);
          return 1;
        }

        console.log('\n=============================================================');
        console.log(` AUDIT REPORT: [${report.spec.id}] ${report.spec.slug} (${report.spec.type})`);
        console.log(` Directory: specs/${report.spec.slug}`);
        console.log('=============================================================');

        if (report.tasks && report.tasks.total > 0) {
          console.log(` Progress: ${report.tasks.completed}/${report.tasks.total} tasks completed (${report.tasks.percentage}%)`);
        }

        if (report.warnings.length > 0) {
          console.log(`\n[WARNINGS] (${report.warnings.length}):`);
          report.warnings.forEach(w => console.log(`  - [WARN] ${w}`));
        }

        if (report.valid) {
          console.log('\n[AUDIT PASSED] Specification complies with SDD Quality Gates.');
          console.log('  Phase 0 clarification verified. Safe for AI agents and human engineers to code.\n');
          return 0;
        } else {
          console.log('\n[AUDIT BLOCKED] Specification fails mandatory SDD criteria:');
          report.errors.forEach(e => console.log(`  - [BLOCKER] ${e}`));
          console.log(`\nAction required: Complete missing sections in specs/${report.spec.slug} before coding.\n`);
          return 1;
        }
      }

      case 'status': {
        const manifest = await loadManifest(workingDir);
        if (!manifest) {
          console.log('[INFO] No OmniSpec manifest found. Run `omni-spec init` to get started.');
          return 1;
        }

        console.log(`\n[PROJECT] ${manifest.project} (${manifest.profile} profile)`);
        console.log(`   Stack:   ${manifest.stack} | Docs: ${manifest.documentationStandard}`);
        
        const active = await getActiveSpec(workingDir);
        if (active) {
          console.log(`\n[ACTIVE] [${active.id}] ${active.title}`);
          console.log(`   Type:    ${active.type}`);
          console.log(`   Folder:  specs/${active.slug}`);
          console.log(`   Branch:  ${active.branch}`);
          console.log(`   Status:  ${active.status}`);
        } else {
          console.log('\n[NONE] No active spec. Run `omni-spec create <type> <name>` to start one.');
        }

        console.log(`\n[HISTORY] Total Specs Recorded: ${manifest.specs.length}`);
        if (manifest.specs.length > 0) {
          manifest.specs.forEach(s => {
            const marker = s.slug === manifest.active_spec ? '*' : ' ';
            console.log(`   [${marker}] [${s.id}] ${s.slug} (${s.type}) - ${s.status}`);
          });
        }
        console.log('');
        return 0;
      }

      case 'complete': {
        const id = args[1];
        if (!id) {
          console.error('[ERROR] Please specify the spec ID or slug to complete.');
          console.log('Usage: omni-spec complete <id>');
          return 1;
        }

        const updated = await updateSpecStatus(workingDir, id, 'COMPLETED');
        console.log(`[OK] Spec [${updated.id}] ${updated.slug} marked as COMPLETED.`);
        return 0;
      }

      default: {
        console.error(`[ERROR] Unknown command: "${command}".`);
        printHelp();
        return 1;
      }
    }
  } catch (err) {
    console.error(`\n[ERROR] ${err.message}\n`);
    return 1;
  }
}
