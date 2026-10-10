# V1 Event Protocol

The event protocol exists only to stop Codex from waiting and to filter worker chatter.

## Final outbox path

`.ai/outbox/<CHANGE_ID>.json`

The Builder writes exactly one terminal event before it exits.

## Schema

```json
{
  "change_id": "C004",
  "status": "RESULT_READY",
  "summary": "One short sentence describing the meaningful outcome.",
  "owner_result": "results/C004/index.html",
  "receipt": "receipts/C004.md",
  "result_commit": "abcdef1",
  "needs_codex": false
}
```

## Status values

### RESULT_READY

The requested result exists and verification completed. The Owner can inspect it directly. This does **not** automatically invoke Codex.

### OWNER_DECISION

A genuine product/taste/meaning fork remains. `owner_result` should point to the smallest useful A/B or evidence artifact when possible.

### NEEDS_CODEX

A strong-model diagnosis is justified. Use sparingly: architecture conflict, protected-boundary risk, repeated repair failure, or contract/repository contradiction.

### FAILED

Provider/tool/runtime/infrastructure failure prevented meaningful completion.

## Filtering rule

Intentional successful Stop is local stopped/cancelled runtime state, with resumable Working State in `.ai/work/<CHANGE_ID>.json`. It emits no semantic inbox event, no success, no default failure, and no Controller wake. A decision candidate is internal to the Pipe; only its one-shot Gate may produce OWNER_DECISION. No fifth inbox status is added. On resumption, read the current card, checkpoint and actual Git/files before continuing; do not infer that a stopped job completed.

Progress, tool calls, intermediate retries, test logs, and model thoughts are never inbox events.

The runner copies only the seven schema fields of the final terminal event to `.ai/inbox/`. `needs_codex` is true only for `NEEDS_CODEX`. A normal `RESULT_READY` never wakes or automatically invokes Codex.

## Runner validation

If the Builder says `RESULT_READY` but the declared receipt, Git result commit or owner result does not exist, the runner changes the effective status to `FAILED` instead of trusting the claim. Invalid status/Change ID/JSON or an abnormal PI exit also produces `FAILED`; no fifth terminal class is introduced.
