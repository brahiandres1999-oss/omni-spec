/**
 * What the project's memory holds today (the «Memoria» page, Fase 3 vuelta 2a): what agents will share from
 * vuelta 5 on (learnings and decisions), Studio's conversations and the code graph.
 */
export function memorySummary(db, workspace) {
  const has = table => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
  const count = table => (has(table) ? db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n : 0);
  return {
    mode: workspace.mode,
    path: workspace.memoryPath,
    counts: {
      observations: count('observations'),
      decisions: count('decisions'),
      conversations: count('studio_conversations'),
      modules: count('modules_graph'),
      dependencies: count('module_dependencies'),
    },
    observations: db
      .prepare(
        'SELECT category, scope, summary, created_at AS createdAt FROM observations ORDER BY created_at DESC LIMIT 20',
      )
      .all(),
    decisions: db
      .prepare(
        'SELECT topic, status, basis, recorded_at AS recordedAt FROM decisions ORDER BY recorded_at DESC LIMIT 20',
      )
      .all(),
  };
}
