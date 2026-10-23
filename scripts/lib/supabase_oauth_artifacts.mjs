// Metadata only: never retrieve or inspect encrypted credential contents here.
const artifactNames = [
  "supabase-oauth-state-primary",
  "supabase-oauth-state-backup",
];
const trustedEvents = new Set([
  "push",
  "schedule",
  "workflow_dispatch",
  "pull_request_target",
]);
const metadataError = () =>
  new Error(
    "Supabase grant metadata is incomplete or changed; restore stopped",
  );
const positiveId = (value) => Number.isSafeInteger(value) && value > 0;
const timestamp = (value) =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

export function selectSupabaseArtifact({
  repository,
  read,
  now = Date.now(),
  currentRunId,
  currentRunAttempt,
}) {
  if (
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "") ||
    !Number.isFinite(now)
  ) {
    throw metadataError();
  }
  const prefix = `/repos/${repository}/actions`;
  let requests = 0;
  const get = (route) => {
    if (requests >= 50)
      throw new Error(
        "Supabase grant metadata request budget exhausted; restore stopped",
      );
    requests += 1;
    try {
      return read(route);
    } catch {
      // Neither an API error body nor a subprocess diagnostic belongs in CI output.
      throw metadataError();
    }
  };
  const workflow = get(`${prefix}/workflows/hosted-service-settings.yml`);
  if (!positiveId(workflow?.id)) throw metadataError();
  const artifacts = [];
  const seen = new Set();
  for (const name of artifactNames) {
    let count;
    let firstPage;
    let received = 0;
    for (let page = 1; ; page += 1) {
      const result = get(
        `${prefix}/artifacts?name=${name}&per_page=100&page=${page}`,
      );
      if (
        !Number.isSafeInteger(result?.total_count) ||
        result.total_count < 0 ||
        !Array.isArray(result.artifacts)
      ) {
        throw metadataError();
      }
      count ??= result.total_count;
      if (
        count !== result.total_count ||
        result.artifacts.length !== Math.min(100, count - received)
      ) {
        throw metadataError();
      }
      firstPage ??= JSON.stringify(result);
      for (const item of result.artifacts) {
        if (
          !positiveId(item?.id) ||
          seen.has(item.id) ||
          item.name !== name ||
          !positiveId(item.workflow_run?.id) ||
          !positiveId(item.workflow_run?.repository_id) ||
          !timestamp(item.created_at) ||
          !timestamp(item.expires_at) ||
          typeof item.expired !== "boolean"
        ) {
          throw metadataError();
        }
        seen.add(item.id);
        artifacts.push(item);
      }
      received += result.artifacts.length;
      if (received === count) break;
    }
    // The API is not a snapshot. Catch page movement instead of treating partial
    // history as permission to use the bootstrap token or an older consumed grant.
    if (
      JSON.stringify(
        get(`${prefix}/artifacts?name=${name}&per_page=100&page=1`),
      ) !== firstPage
    ) {
      throw metadataError();
    }
  }
  artifacts.sort(
    (a, b) =>
      Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id,
  );
  const runs = new Map();
  let selected;
  for (const item of artifacts) {
    if (
      selected &&
      Date.parse(item.created_at) < Date.parse(selected.created_at)
    )
      break;
    const runId = item.workflow_run.id;
    if (!runs.has(runId)) runs.set(runId, get(`${prefix}/runs/${runId}`));
    const run = runs.get(runId);
    if (
      !positiveId(run?.id) ||
      run.id !== runId ||
      !positiveId(run.workflow_id) ||
      !positiveId(run.repository?.id) ||
      typeof run.repository.full_name !== "string" ||
      typeof run.event !== "string" ||
      typeof run.status !== "string"
    )
      throw metadataError();
    if (
      run.workflow_id !== workflow.id ||
      run.repository.full_name !== repository ||
      run.repository.id !== item.workflow_run.repository_id ||
      !trustedEvents.has(run.event)
    )
      continue;
    const sameRetry =
      run.status === "in_progress" &&
      String(run.id) === currentRunId &&
      positiveId(run.run_attempt) &&
      run.run_attempt > 1 &&
      String(run.run_attempt) === currentRunAttempt;
    if (run.status !== "completed" && !sameRetry) {
      throw new Error(
        "Newest Supabase grant run is not complete or the current retry; restore stopped",
      );
    }
    if (selected && selected.workflow_run.id !== runId) {
      throw new Error(
        "Supabase grant creation order is ambiguous; restore stopped",
      );
    }
    selected ??= item;
  }
  if (!selected) return null;
  if (selected.expired || Date.parse(selected.expires_at) <= now) {
    throw new Error("Newest Supabase grant copy is expired; restore stopped");
  }
  return selected.id;
}
