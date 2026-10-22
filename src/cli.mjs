import { readFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { scaffoldProject, createSpec } from './generator.mjs';
import { runWizard } from './wizard.mjs';
import { loadManifest, saveManifest, withManifestLock, updateSpecStatus, focusSpec, listSpecs } from './manifest.mjs';
import { auditSpec } from './auditor.mjs';
import { verifySpec, describeFailure } from './verification.mjs';
import { checkProjectVersion, updateProject, getCliVersion } from './updater.mjs';
import { installPlugin, updatePlugin, getPluginStatus, cleanProject } from './plugin-manager.mjs';
import { installAgentIntegrations, normalizeAgents, agentInstructions, AGENTS } from './integrations.mjs';
import { detectProjectEnvironment } from './detector.mjs';
import { auditProjectContext } from './context-auditor.mjs';
import { fitQuestionnaire, specRoute } from './fit.mjs';
import { projectStatus, recordContext, recordSession, recordDecision } from './project-state.mjs';
import { loadChecks, validateChecks } from './checks.mjs';
import { safePath } from './managed.mjs';
import { writeFileAtomic } from './fs-retry.mjs';
import { listContracts, readContract, updateContract } from './contracts.mjs';
import { fileURLToPath } from 'node:url';

const mutating = new Set([
  'create',
  'focus',
  'complete',
  'verify',
  'update',
  'setup-agent',
  'configure',
  'clean',
  'context-record',
  'session-record',
  'decision-record',
  'contract-record',
]);
const aliases = {
  switch: 'focus',
  specs: 'list',
  upgrade: 'update',
  'setup-agents': 'setup-agent',
  'omni-init': 'init',
  prune: 'clean',
};
const valueFlags = new Set(['profile', 'name', 'stack', 'doc', 'gates', 'agent', 'ai', 'manual', 'timeout', 'from']);
const booleanFlags = new Set(['yes', 'force', 'dry-run', 'json', 'accept-updates', 'allow-downgrade']);

function acceptanceSummary(acceptance) {
  if (acceptance.error) return `Acceptance review failed: ${acceptance.error}`;
  const methods = {};
  for (const criterion of acceptance.criteria) methods[criterion.method] = (methods[criterion.method] || 0) + 1;
  return `Acceptance: ${acceptance.criteria.length} criteria declared passed (${Object.entries(methods)
    .map(([method, count]) => `${method}: ${count}`)
    .join(
      ', ',
    )}).\nAutomated criteria are bound to configured check results; this does not prove the adequacy of assertions or the truth of manual evidence.\n${acceptance.criteria
    .filter(item => item.method === 'automated')
    .map(item => `${item.id}: ${item.execution}`)
    .join('\n')}`;
}

function parse(args) {
  const flags = {},
    positionals = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] === '-y' ? '--yes' : args[i];
    if (!arg.startsWith('-')) {
      positionals.push(arg);
      continue;
    }
    const name = arg.slice(2);
    if (booleanFlags.has(name)) flags[name] = true;
    else if (valueFlags.has(name)) {
      if (args[i + 1] === undefined || args[i + 1].startsWith('--')) throw new Error(`Missing value for ${arg}`);
      flags[name] = args[++i];
      if (name !== 'gates' && !flags[name].trim()) throw new Error(`Empty value for ${arg}`);
    } else throw new Error(`Unknown option: ${arg}`);
  }
  flags.agent = flags.agent || flags.ai;
  flags.dryRun = flags['dry-run'];
  flags.acceptUpdates = flags['accept-updates'];
  flags.allowDowngrade = flags['allow-downgrade'];
  if (flags.timeout !== undefined) {
    flags.timeout = Number(flags.timeout);
    if (!Number.isSafeInteger(flags.timeout) || flags.timeout < 100 || flags.timeout > 3600000)
      throw new Error('--timeout must be 100..3600000 milliseconds.');
  }
  return { flags, positionals };
}

/**
 * Read a JSON declaration from a file (absolute, or relative to the project root) or from
 * standard input with `-`. Input files may live outside the project, for example in a
 * temporary directory, so they never enter verification or context snapshots.
 */
async function readJsonInput(root, from) {
  let raw;
  if (from === '-') {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    raw = Buffer.concat(chunks).toString('utf8');
  } else raw = await readFile(resolve(root, from), 'utf8');
  try {
    return JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new Error(`Invalid JSON in ${from === '-' ? 'standard input' : from}: ${error.message}`);
  }
}

async function findProjectRoot(start) {
  let current = resolve(start);
  while (true) {
    try {
      await access(join(current, 'specs', 'manifest.json'));
      return current;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function printHelp(version = '') {
  console.log(`OmniSpec v${version} — project-local Spec-Driven Development

omni-spec <command> [arguments] [options]
  init [--yes] [--agent name]     Bootstrap project and chat workflows
  inspect [--json]               Read-only environment inventory; no scripts executed
  context-check [--json]         Check context structure/local links; semantic review required
  context-record                Snapshot reconciled context inputs; retain previous baseline
  guide <design|setup|evidence> Read bundled procedures and record shapes; no external skill
  session-record --from <file|->  Record actual host capabilities (does not grant tools)
  decision-record --from <file|-> Record answer/delegation and dated technology sources
  checks [--from <file|->]        List/configure reviewed checks with IDs and module cwd
    --from accepts a JSON file anywhere (relative paths resolve from the project root) or - for stdin
  contracts [id]                Inspect proposed and effective capability contracts
  contract-record <id> --from <file|->  Record revision with decision and expectedRevision
  create <type> <name>           feature, bugfix (bug/fix), debt, rfc (idea)
  status | list [--json]         Resume active work or list specifications
  focus <id|slug>                Select active work without creating duplicates
  audit [id] [--json]            Structural document checks, not code verification
  fit [id] [--json]              Read the ceremony route for a change and its questionnaire
  configure --gates <commands>   Set reviewed checks (newline separated; root cwd)
  verify [id]                    Run configured checks and bind evidence to source
    --manual <reason>           Explicit manual evidence when no checks apply
    --timeout <ms>              Per-command timeout (default 120000)
  complete <id>                 Require audit, completed tasks and fresh verification
  check | doctor [--json]        Inspect version and managed-file integrity
  update --dry-run              Preview exact changed files and conflicts
  update [--accept-updates]      Preserve edits; opt in to backup and replacement
    --allow-downgrade           Explicitly permit an older/pre-release CLI after review
  clean [--dry-run] [--accept-updates]  Antigravity plugin mode: remove managed runtime/omni-* skills only
                                 (modified copies block unless --accept-updates backs them up)
  plugin <install|update|status> Manage Antigravity global plugin (~180 KB clean install)
  setup-agent <name[,name]>      Select/persist adapters; keep other existing files
  help | version

init options: --name --stack --doc --profile --gates --agent (alias --ai)
  --force explicitly replaces constitution/templates; existing specs are preserved.
Agents: ${Object.keys(AGENTS).join(', ')}, all
After bootstrap: /omni-init -> /omni-discuss or /omni-specify.
Invocation syntax varies by host; use its installed skill/command picker.
Local CLI: node specs/.omni/runtime/bin/omni-spec.mjs <command>
`);
}

export async function runCli(args = process.argv.slice(2), workingDir = process.cwd()) {
  let json = false;
  try {
    const raw = args[0] || 'help';
    if (['help', '--help', '-h'].includes(raw) || args.includes('--help')) {
      printHelp(await getCliVersion());
      return 0;
    }
    if (['version', '--version', '-v'].includes(raw)) {
      console.log(`omni-spec v${await getCliVersion()}`);
      return 0;
    }
    const command = aliases[raw] || raw;
    const { flags, positionals } = parse(args.slice(1));
    json = Boolean(flags.json);
    if (flags.dryRun && !['update', 'clean'].includes(command))
      throw new Error('--dry-run is supported only by update and clean. No changes made.');
    if (flags.allowDowngrade && command !== 'update') throw new Error('--allow-downgrade is supported only by update.');
    if (flags.force && command !== 'init')
      throw new Error('--force is supported only by init. Use update --accept-updates after reviewing conflicts.');
    if (flags.manual !== undefined && command !== 'verify') throw new Error('--manual is supported only by verify.');
    if (flags.timeout !== undefined && command !== 'verify') throw new Error('--timeout is supported only by verify.');
    if (flags.acceptUpdates && !['update', 'setup-agent', 'clean'].includes(command))
      throw new Error('--accept-updates is supported only by update, setup-agent and clean.');
    if (json && command === 'init' && !flags.yes) throw new Error('init --json requires --yes.');
    const maxPositionals =
      {
        create: 2,
        focus: 1,
        complete: 1,
        verify: 1,
        audit: 1,
        fit: 1,
        'setup-agent': 1,
        plugin: 1,
        contracts: 1,
        'contract-record': 1,
        guide: 1,
      }[command] || 0;
    if (positionals.length > maxPositionals) throw new Error(`Unexpected arguments for ${command}. Run help.`);
    const emit = (value, human) =>
      console.log(json ? JSON.stringify(value, null, 2) : human || JSON.stringify(value, null, 2));
    if (flags.agent) normalizeAgents(flags.agent); // Validate before creating any files.
    const root = await findProjectRoot(workingDir);
    if (command === 'init' && root && root !== resolve(workingDir))
      throw new Error(
        `Already inside an OmniSpec project (root: ${root}). Run init from its root; nested projects are not initialized implicitly.`,
      );
    if (command !== 'init' && root) workingDir = root;
    if (mutating.has(command) && !root) throw new Error('No OmniSpec project found. Run omni-spec init first.');
    switch (command) {
      case 'guide': {
        if (!['design', 'setup', 'evidence'].includes(positionals[0]))
          throw new Error('Usage: guide <design|setup|evidence>');
        const content = await readFile(
          fileURLToPath(new URL(`./resources/${positionals[0]}.md`, import.meta.url)),
          'utf8',
        );
        emit({ topic: positionals[0], content, requiresExternalSkill: false }, content);
        return 0;
      }
      case 'init': {
        const options = await runWizard(workingDir, flags);
        if (!options) return 0;
        const result = await scaffoldProject(workingDir, options);
        emit(
          result,
          `[OK] OmniSpec files installed at ${workingDir}\n${agentInstructions(options.agent)}\nContext pending; application not validated. Run omni-init without extra instructions to recognize this project.\nLocal CLI: node specs/.omni/runtime/bin/omni-spec.mjs status`,
        );
        return 0;
      }
      case 'inspect': {
        const environment = await detectProjectEnvironment(workingDir);
        emit({ root: workingDir, ...environment });
        return 0;
      }
      case 'context-check': {
        if (!root) throw new Error('No OmniSpec project found. Run init first.');
        const result = await auditProjectContext(workingDir);
        emit(
          result,
          `[CONTEXT ${result.valid ? 'STRUCTURE PASSED' : 'BLOCKED'}] Structure and local links only; source-claim review required.\n${result.errors.join('\n')}\n${result.warnings.join('\n')}`,
        );
        return result.valid ? 0 : 1;
      }
      case 'context-record': {
        const result = await recordContext(workingDir);
        emit(
          result,
          '[CONTEXT RECORDED] Current input baseline saved; previous baseline preserved. Source-claim review remains required.',
        );
        return 0;
      }
      case 'session-record':
      case 'decision-record':
      case 'contract-record': {
        if (!flags.from) throw new Error(`${command} requires --from <JSON file or ->.`);
        const input = await readJsonInput(workingDir, flags.from);
        const { expectedRevision, ...contractChange } = input;
        const result =
          command === 'session-record'
            ? await recordSession(workingDir, input)
            : command === 'decision-record'
              ? await recordDecision(workingDir, input)
              : await updateContract(workingDir, positionals[0], contractChange, { expectedRevision });
        emit(result);
        return 0;
      }
      case 'checks': {
        if (!root) throw new Error('No OmniSpec project found. Run init first.');
        if (flags.from) {
          const input = await readJsonInput(workingDir, flags.from);
          await validateChecks(workingDir, input);
          await withManifestLock(workingDir, async () => {
            await writeFileAtomic(
              await safePath(workingDir, 'specs/checks.json'),
              JSON.stringify(input, null, 2) + '\n',
            );
          });
        }
        emit({ checks: await loadChecks(workingDir, await loadManifest(workingDir)), executed: false });
        return 0;
      }
      case 'contracts': {
        if (!root) throw new Error('No OmniSpec project found. Run init first.');
        emit(positionals[0] ? await readContract(workingDir, positionals[0]) : await listContracts(workingDir));
        return 0;
      }
      case 'create': {
        if (positionals.length !== 2)
          throw new Error('Usage: create <feature|bugfix|debt|rfc> <name> (quote names containing spaces).');
        const spec = await createSpec(workingDir, ...positionals);
        emit(
          spec,
          `[OK] Created specs/${spec.slug} (${spec.archetype}).\nSuggested branch: ${spec.branch} (not created).\nClarify requirements, then plan the change; no implementation is verified yet.`,
        );
        return 0;
      }
      case 'status':
      case 'list': {
        const manifest = await loadManifest(workingDir);
        if (!manifest) throw new Error('No OmniSpec manifest found. Run init first.');
        if (command === 'status') {
          const status = await projectStatus(workingDir);
          emit(
            status,
            `[PROJECT] ${manifest.project} | v${manifest.version}\n[AGENTS] ${manifest.agent}\n[ACTIVE] ${manifest.active_spec || 'None — use omni-discuss or create'}\n[DELIVERY] ${status.progress.delivery}\n[CONTEXT] ${status.progress.context.status}\n[NEXT] ${status.progress.nextAction}\n${status.progress.blockers.map(item => `[BLOCKED] ${item.code}: ${item.message || item.action}`).join('\n')}\n${manifest.specs.map(s => `[${s.id}] ${s.slug} (${s.type}) ${s.status}`).join('\n')}`,
          );
        } else {
          const listing = await listSpecs(workingDir);
          emit(
            listing,
            `[SPECS] ${listing.project}\n${listing.specs.length ? listing.specs.map(s => `${s.slug === listing.active_spec ? '*' : ' '} ${s.id.padEnd(5)} ${s.type?.padEnd(8) || 'unknown '} ${s.status.padEnd(12)} ${s.slug}`).join('\n') : 'No specifications. Use omni-discuss for exploration or create for a defined change.'}`,
          );
        }
        return 0;
      }
      case 'focus': {
        if (positionals.length !== 1) throw new Error('Usage: focus <id|slug>');
        const focused = await focusSpec(workingDir, positionals[0]);
        emit(focused, `[ACTIVE] ${focused.slug} (${focused.type}) — ${focused.status}`);
        return 0;
      }
      case 'audit': {
        const report = await auditSpec(workingDir, positionals[0]);
        emit(
          report,
          `[AUDIT ${report.valid ? 'PASSED' : 'BLOCKED'}] Structural document checks only.\n${report.errors.join('\n')}\n${report.warnings.map(w => '[WARN] ' + w).join('\n')}\nTasks: ${report.tasks?.completed || 0}/${report.tasks?.total || 0}. Code tests were not executed.`,
        );
        return report.valid ? 0 : 1;
      }
      case 'verify': {
        const result = await verifySpec(workingDir, positionals[0], flags);
        emit(
          result,
          `[VERIFICATION ${result.passed ? 'RECORDED' : 'FAILED'}] Gate mode: ${result.mode}\n${result.results.map(r => `${r.command}: exit ${r.exitCode}${r.timedOut ? ' (timeout)' : ''}\n${r.output}${r.outputTruncated ? '\n[OUTPUT TRUNCATED: full bounded log ' + r.outputLog + ']' : ''}${r.error ? '\n' + r.error : ''}`).join('\n')}\n${result.passed ? `Evidence is bound to the current snapshot (${result.attestedFiles} project files outside specs/; ignored paths excluded).` : `Not recorded as passed: ${describeFailure(result)}`}${result.sourceChangedDuringVerification ? `\nChanged while checks ran:\n${result.changedDuringVerification.map(name => '  ' + name).join('\n')}` : ''}\n${acceptanceSummary(result.acceptance)}`,
        );
        return result.passed ? 0 : 1;
      }
      case 'complete': {
        if (positionals.length !== 1) throw new Error('Usage: complete <id>');
        const updated = await updateSpecStatus(workingDir, positionals[0], 'COMPLETED');
        emit(
          updated,
          `[OK] ${updated.slug} COMPLETED; gate mode: ${updated.verification.mode}.\n${acceptanceSummary(updated.verification.acceptance)}`,
        );
        return 0;
      }
      case 'fit': {
        if (!root) throw new Error('No OmniSpec project found. Run init first.');
        const manifest = await loadManifest(workingDir);
        const spec = manifest?.specs.find(s =>
          positionals[0] ? s.id === positionals[0] || s.slug === positionals[0] : s.slug === manifest.active_spec,
        );
        if (!spec) throw new Error('Specification not found. Use list and an exact ID.');
        const route = await specRoute(workingDir, spec);
        if (!route) {
          const questionnaire = { ...fitQuestionnaire(2), file: `specs/${spec.slug}/fit.json` };
          emit(
            { spec: spec.slug, type: spec.type, classified: false, ...questionnaire },
            `[FIT] ${spec.slug} is not classified yet.\nRecord the answers in ${questionnaire.file} as JSON with "schemaVersion": 2 and every key below, then run this command again.\n${questionnaire.questions.map(q => `- ${q.id}: ${q.prompt} (${Array.isArray(q.values) ? q.values.map(v => JSON.stringify(v)).join(' | ') : q.values})`).join('\n')}\nExample shape: ${JSON.stringify(questionnaire.example)}`,
          );
          return 0;
        }
        if (route.route === 'invalid') {
          emit(
            { spec: spec.slug, type: spec.type, classified: true, route: 'invalid', errors: route.errors },
            `[FIT] ${spec.slug} has an invalid fit.json.\n${route.errors.join('\n')}`,
          );
          return 1;
        }
        emit(
          {
            spec: spec.slug,
            type: spec.type,
            classified: true,
            route: route.route,
            reasons: route.reasons,
            artifacts: route.artifacts,
            summary: route.summary,
          },
          `[FIT] ${spec.slug}: ${route.route.toUpperCase()} — ${route.summary}\n${route.reasons.map(r => '- ' + r).join('\n')}\nRequired artifacts: ${
            Object.entries(route.artifacts)
              .filter(([, needed]) => needed)
              .map(([name]) => name)
              .join(', ') || 'primary artifact only'
          }.`,
        );
        return 0;
      }
      case 'configure': {
        if (flags.gates === undefined)
          throw new Error(
            'Usage: configure --gates "<reviewed commands>". Use an empty string to explicitly clear gates.',
          );
        await withManifestLock(workingDir, async () => {
          const manifest = await loadManifest(workingDir);
          const path = join(workingDir, 'CONSTITUTION.md');
          const content = await readFile(path, 'utf8');
          const section = `## 4. Delivery Quality Gates\n\nConfigured commands, executed from the project root by verify. Review commands before execution.\n\n\`\`\`text\n${flags.gates || '# No automated checks configured; explicit manual evidence is required.'}\n\`\`\`\n\n`;
          const pattern = /^## 4\. Delivery Quality Gates[^\n]*\n[\s\S]*?(?=^## |$(?![\s\S]))/m;
          if (!pattern.test(content))
            throw new Error(
              'Custom constitution has no recognizable Delivery Quality Gates section. Add that section before configuring commands; custom text was preserved.',
            );
          await writeFileAtomic(
            path,
            content.replace(pattern, () => section),
          );
          manifest.qualityGates = flags.gates;
          await saveManifest(workingDir, manifest);
        });
        emit(
          { configured: true, qualityGates: flags.gates },
          '[OK] Gates configured, not executed. Prior verification becomes stale.',
        );
        return 0;
      }
      case 'check':
      case 'doctor': {
        const check = await checkProjectVersion(workingDir);
        emit(
          check,
          `[${!check.isInstalled ? 'NOT INITIALIZED' : check.healthy ? 'FILES SYNCHRONIZED' : 'NEEDS REVIEW'}] ${check.message}\n${check.integrity?.changed.join('\n') || ''}`,
        );
        return check.healthy ? 0 : 1;
      }
      case 'update': {
        const result = await updateProject(workingDir, flags);
        const { created, updated, conflicts, backups } = result.assets;
        emit(
          result,
          `[${result.dryRun ? 'DRY RUN' : 'UPDATED'}] ${result.project}: ${result.fromVersion} -> ${result.toVersion}\nFiles: ${created.length} new, ${updated.length} changed, ${conflicts.length} conflicts. Specs preserved: ${result.specsPreserved}.\n${result.dryRun ? [...created.map(p => 'CREATE ' + p), ...updated.map(p => 'UPDATE ' + p)].join('\n') : ''}\n${conflicts.map(p => 'CONFLICT ' + p).join('\n')}\n${backups.map(p => 'BACKUP ' + p).join('\n')}${result.constitution?.status === 'PRESERVED_REVIEW_RECOMMENDED' ? `\nCONSTITUTION.md preserved. Compare it with ${result.constitution.reference} to adopt current guidance.` : ''}`,
        );
        return conflicts.length ? 1 : 0;
      }
      case 'setup-agent': {
        const result = await withManifestLock(workingDir, async () => {
          const manifest = await loadManifest(workingDir);
          const agent = normalizeAgents(positionals[0] || flags.agent || manifest.agent).join(',');
          const assets = await installAgentIntegrations(workingDir, { ...manifest, agent }, flags);
          manifest.agent = agent;
          await saveManifest(workingDir, manifest);
          return { agent, ...assets, invocation: agentInstructions(agent) };
        });
        emit(
          result,
          `[OK] Selected adapters: ${result.agent}\nFiles: ${result.created.length} new, ${result.updated.length} updated.\n${result.invocation}\nReload the project if the host has not discovered the commands. File generation is not a host-chat test.`,
        );
        return 0;
      }
      case 'plugin': {
        const sub = positionals[0] || 'status';
        if (sub === 'install') {
          const res = await installPlugin(flags);
          emit(
            res,
            `[PLUGIN INSTALLED] OmniSpec plugin v${res.version} installed at:\n${res.targetDir}\nFiles copied: ${res.copied.join(', ')}\nReload the host if needed and confirm skill discovery; file installation does not establish host behavior.`,
          );
          return 0;
        } else if (sub === 'update' || sub === 'upgrade') {
          const res = await updatePlugin(flags);
          emit(
            res,
            `[PLUGIN UPDATED] OmniSpec plugin v${res.version} updated at:\n${res.targetDir}\nFiles updated: ${res.copied.join(', ')}`,
          );
          return 0;
        } else if (sub === 'status') {
          const res = await getPluginStatus(flags);
          emit(
            res,
            `[PLUGIN ${res.installed ? 'INSTALLED' : 'NOT INSTALLED'}] Target: ${res.targetDir}\nVersion: ${res.version || 'none'} (CLI: ${res.currentCliVersion})${res.isOutdated ? ' -> Run plugin update' : ''}`,
          );
          return res.installed ? 0 : 1;
        } else {
          throw new Error(`Unknown plugin subcommand: ${sub}. Valid: install, update, status.`);
        }
      }
      case 'clean': {
        const result = await cleanProject(workingDir, flags);
        if (result.dryRun) {
          emit(
            result,
            `[DRY RUN] OmniSpec clean for ${result.project} (${result.fromAgent} -> ${result.toAgent})\nManaged files to remove: ${result.toRemove.length}\n${result.toRemove.map(p => '- ' + p).join('\n') || 'None'}\n${result.conflicts.map(p => 'CONFLICT ' + p).join('\n')}\nPreserved: ${result.preserved}. Specs: ${result.specsCount}`,
          );
        } else {
          emit(
            result,
            `[CLEANED] ${result.project} migrated to plugin mode (v${result.version}).\nRemoved ${result.removed.length} managed files.${result.backups.length ? `\n${result.backups.map(p => 'BACKUP ' + p).join('\n')}` : ''}\nPreserved: ${result.preserved}. Specs: ${result.specsCount}.`,
          );
        }
        return 0;
      }
      default:
        throw new Error(`Unknown command: ${command}. Run help.`);
    }
  } catch (error) {
    console.error(json ? JSON.stringify({ error: error.message }) : `[ERROR] ${error.message}`);
    return 1;
  }
}
