/* Counts only: never copy provider errors, document text or credentials to issues. */
const fs = require('node:fs');

module.exports = async function report({github, context, core, failed, path = 'fcc-refresh-report.json'}) {
  let result;
  try { result = JSON.parse(fs.readFileSync(path, 'utf8')); } catch {
    failed = true;
    core.setFailed('The FCC refresh did not produce a readable completion report');
  }
  const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 'unknown';
  const collection = result?.collection ?? {};
  const backlog = result?.backlog ?? {};
  const problem = failed || !result || result.needs_attention !== false || result.source_gaps !== 0 || result.reading_gaps !== 0;
  const run = `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`;
  const title = 'FCC political-file archive: unresolved gaps or unfinished work';
  const body = [
    `Net: ${problem ? 'The KSTP-TV, KARE and KMSP-TV archive has source gaps or unfinished work.' : 'The KSTP-TV, KARE and KMSP-TV check finished with no source gaps or unfinished work.'}`,
    '',
    `- Run failed or did not produce a report: ${failed || !result ? 'yes' : 'no'}`,
    `- Political files listed: ${count(collection.listed_files)}`,
    `- Files downloaded and retained: ${count(collection.files_stored ?? 0)}`,
    `- Recent unchanged files listed: ${count(collection.files_unchanged ?? 0)}`,
    `- Files the FCC did not make available: ${count(result?.source_gaps)}`,
    `- Failed folders: ${count(collection.folders_failed ?? 0)}`,
    `- Failed file operations: ${count(collection.files_failed ?? 0)}`,
    `- Downloads waiting: ${count(backlog.downloads)}`,
    `- Second copies waiting: ${count(backlog.second_copies)}`,
    `- Documents waiting for a first text reading: ${count(backlog.readings)}`,
    `- Documents with incomplete readings: ${count(result?.reading_gaps)}`,
    `- Documents with unresolved reader failures: ${count(result?.reading_operational_failures)}`,
    '',
    'Source gaps remain recorded and are retried. A source refusal does not mean a file was saved. A missing folder or failed storage operation prevents a successful collection check.',
    '',
    'The next daily run resumes bounded work. For repeated failures, inspect the failed phase and private settings. Preserve saved originals and conflicting copies. Manual refreshes must share the workflow queue; coordinate any local writer.',
    '',
    `[Latest run](${run}) · [FCC political files: collection and recovery](https://github.com/alethical-org/alethical/blob/main/docs/implementation/fcc-political-files.md)`,
  ].join('\n');
  await core.summary.addRaw(body).write();
  const issues = await github.paginate(github.rest.issues.listForRepo, {
    ...context.repo, state: 'all', labels: 'backend', per_page: 100,
  });
  const existing = issues.find(issue => !issue.pull_request && issue.title === title);
  if (existing) {
    await github.rest.issues.update({
      ...context.repo, issue_number: existing.number, body,
      state: problem ? 'open' : 'closed',
    });
  } else if (problem) {
    await github.rest.issues.create({...context.repo, title, body, labels: ['backend']});
  }
};
