# Incident replay runbook (quote decision graph)

## Purpose

Use deterministic quote replay artifacts to triage production quote incidents and prevent regressions.

## Workflow

1. **Collect artifact**
   - Re-run the affected quote with `x-explain: true`.
   - Capture the `replay_artifact` payload and `artifact_id`.
2. **Verify deterministic replay**
   - Confirm `replay.matches_production == true`.
   - If false, treat as deterministic drift and escalate immediately.
3. **Inspect decision graph**
   - Review `graph.request` and each `graph.nodes[*]` stage in order.
   - Validate candidate ranking and final source selection against the incident report.
4. **Check redaction compliance**
   - Ensure issuer/account-like identifiers are masked as `:REDACTED`.
   - Do not store or share unredacted identifiers in incident tickets.
5. **Close the incident with regression coverage**
   - Add/adjust a backend test reproducing the decision path.
   - Confirm replay remains deterministic before merging the fix.
