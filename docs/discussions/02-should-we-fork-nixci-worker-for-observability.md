# Round 2: Should We Fork the NixCI Worker for Observability?

**Status:** recommendation converged; owner and operational gates remain open
**Date:** 2026-11-23
**IC:** Codex (current session)
**Scope:** decide whether a custom NixCI worker fork is a sound way to obtain trustworthy Emerald job attribution and useful local telemetry.

## Roster

- Codex CLI
- Gemini CLI (`agy`)
- Claude CLI
- GitHub Copilot CLI
- DeepSeek API

The same five real seats from Round 1 receive the shared prompt below. No private source code is included in the prompt or archived here. OpenCode enrichment remains unrun because the available profile does not enforce a tool-free session.

### Run record

| Seat | Invocation | Result |
| --- | --- | --- |
| Codex | `codex exec` with read-only sandbox, from `/tmp` | Substantive response; all five markers present. |
| Gemini | `agy -p`, plan mode, from `/tmp` | Substantive response; all five markers present. |
| Claude | `claude -p`, tools disabled, from `/tmp` | Substantive response; all five markers present. |
| GitHub Copilot | `copilot -p`, empty available-tools list, built-in MCP disabled | Substantive response; all five markers present. |
| DeepSeek | Direct DeepSeek API request, model `deepseek-chat` | Substantive response; all five markers present. |

The raw replies were temporary working artifacts and are not archived. The summary below preserves the independent recommendations and the remaining conditions. No repository was forked, no provider was contacted, and no live host was changed.

## Shared prompt

You are a participant in a follow-up design round for `nixci-observatory`. Give an independent recommendation on whether to fork NixCI's worker code to get the attribution and observability data this operator wants. Do not edit files, contact NixCI, inspect or request private source code, fork a repository, or make live host changes. Treat legal rights, technical feasibility, and operational support as separate questions. Explicitly distinguish public evidence from assumptions.

### Round 1 findings

All five seats agreed that host cgroup CPU/memory and public NixCI suite status are useful but insufficient to prove which worker performed a named job. They recommended an attempt-scoped worker lifecycle record, bound to the Emerald VM incarnation and correlated with NixCI's outcome for the same attempt. They did not establish a safe guest-to-host transport.

The current dashboard already presents Emerald host load, safe-worker VM service/cgroup CPU and memory, and public suite history as separate streams. It is read-only and loopback-bound. The safe worker uses a QEMU guest, one slot, 12 configured vCPUs, 48 GiB, and `auto-wipe = true`. The host does not currently expose guest job records. An explicit suite submission for `nix-clan-homelab` returned HTTP 402 and did not start.

### Public and governance evidence

- NixCI's public self-hosting documentation says NixCI is not open source and directs subscribers to contact NixCI to obtain self-hosting packages: <https://nix-ci.com/documentation/self-hosting>.
- Public worker module docs describe per-slot `job.json` records inside the guest and optional debug SSH settings, but do not specify the record schema or expose a worker identity through the public Leader API: <https://nix-ci.com/documentation/self-hosting/nixos/worker>.
- The published API reference documents suite submission and waiting, not worker placement: <https://staging.nix-ci.com/documentation/api>.
- No explicit permission to create, redistribute, or maintain a fork is established in this prompt. Repository access by invitation, if any, must not be treated as a license or fork approval.

### Alternatives to compare

1. **Ask for an upstream observability interface:** a supported, versioned local event stream or hook with job/attempt ID, slot, worker identity, VM incarnation, claim/start/finish/cancel state, timestamps, and exit outcome; optionally expose a worker identity in the Leader API.
2. **Use a local adapter around documented worker state:** only if the installed version provides a stable job record and a safe, supported guest-to-host path. Do not assume `job.json` proves execution started or completed.
3. **Maintain a private fork:** make the smallest worker change that emits allowlisted lifecycle events and resource boundaries while preserving safe-worker isolation and upstream security fixes.
4. **Keep the current dashboard host-only:** continue showing VM load and provider suite state separately if no supported attribution feed is available.

### Questions

**Q1 — Recommendation.** Under what conditions is a worker fork worthwhile, and when should it be rejected in favor of an upstream feature or local adapter? Give a clear recommendation for this case, including the present HTTP 402 limitation.

**Q2 — Minimum product change.** What is the smallest NixCI-side interface that would solve attribution and improve observability? Specify stable identities and lifecycle semantics. Separate essential fields from optional metrics.

**Q3 — Fork feasibility and stewardship.** Assess access/license/permission, compatibility with worker releases, security response, tests, binary provenance, operator maintenance burden, and how a fork avoids becoming a divergent CI product. Do not assume permission from access.

**Q4 — Safety and telemetry boundary.** Compare a worker-native event hook, a guest exporter plus one-way host channel, debug SSH, and shared mounts. Identify which options could preserve the safe-worker boundary, and what must be verified before choosing one.

**Q5 — Decision gate and owner conversation.** Recommend a staged decision: what to ask the owner, what evidence to gather without live changes, and the measurable criteria that would justify a time-boxed fork. Provide a short, neutral question the maintainer could present to the owner.

For each question, end with exactly one applicable marker: `[satisfied]`, `[satisfied-conditional: ...]`, or `[needs more evidence: ...]`. State what evidence would resolve any conditional or unmet marker. Keep the response focused and preserve meaningful disagreement.

## Voice summaries

### Codex CLI

Defer a fork. Ask for a supported upstream feed first; consider a local adapter only if the installed worker exposes execution transitions and a Leader-correlatable attempt ID over a safe path. Fork only if the adapter is insufficient, upstream cannot deliver in the needed timeframe, NixCI grants explicit rights, and a security-update path and maintainer are in place. Codex proposed a short disposable pilot with success, failure, cancellation, requeue, crash and reboot cases.

### Gemini CLI (`agy`)

Reject a fork now because dispatch is blocked and rights are unconfirmed. Keep host-only telemetry, request an upstream hook, then evaluate an adapter. Its proposed fork was a small, time-boxed event-only patch after written authorization and an active workload. Numeric limits such as a line-count cap or 90-day duration were individual suggestions, not shared thresholds.

### Claude CLI

Do not fork now: permission is absent, there is no successful test job to validate, and the current dashboard can honestly show host load without placement claims. It requires explicit rights, upstream refusal or indefinite deferral, a bounded additive patch, and working CI before reconsideration. It suggested an expiry date for any eventual fork.

### GitHub Copilot CLI

Resolve the HTTP 402 first, then test whether an adapter over documented slot state suffices. A fork is a last resort if the source or transport cannot provide execution-grade attribution and the operator accepts ongoing maintenance. It preferred a worker/Leader-side event feed over guest telemetry where possible, with a shared attempt ID and VM incarnation.

### DeepSeek API (`deepseek-chat`)

Do not fork until the job path is runnable, NixCI has answered an upstream feature request, and written permission to modify and maintain the worker is confirmed. It proposed a versioned append-only event stream with attempt, worker, VM-incarnation and slot IDs plus lifecycle state and outcome. A fork should add event emission only, without changing scheduling or isolation.

## Synthesis

**Recommendation: do not fork now.** All five seats agreed on this recommendation. The current HTTP 402 test submission did not start, so there is no real attempt against which to validate an attribution change. NixCI's public self-hosting documentation says the product is not open source; no modification or redistribution rights are established here. Repository access by invitation must not be treated as fork permission.

The preferred order is:

1. Keep the current dashboard honest and host-only: show Emerald and worker-VM load separately from NixCI suite outcomes.
2. Ask NixCI for a supported, versioned worker lifecycle feed or local hook, and whether the same attempt identity can be joined to the Leader outcome. Resolve the HTTP 402 before trying to validate a live job path.
3. Inspect documented worker records and transport options offline. A local adapter is acceptable only if the installed version exposes a stable execution-start and terminal event, the attempt ID joins to provider status, and the guest-to-host path preserves the safe-worker boundary. The documented existence of `job.json` alone does not prove those properties.
4. Consider a private fork only if the adapter is insufficient, upstream declines or cannot provide the interface in an acceptable timeframe, written modification/maintenance permission is granted, and a named maintainer can carry security updates. Keep any approved trial narrow, time-boxed, and reversible.

The minimum useful NixCI-side interface is a versioned per-attempt event stream. Essential fields are a stable suite/job/attempt identity, worker identity, VM incarnation, slot, sequence, lifecycle transition (`claimed`, `started`, terminal result), event time, and exit outcome. Add resource metrics only where the worker can measure them reliably; Emerald's cgroup already supplies VM-level CPU and memory. The Leader should expose a matching attempt result or lookup so local execution evidence can be checked against provider outcome.

No transport was proven safe by this discussion. Prefer an upstream-supported worker-native event interface. A guest exporter with a one-way host channel is a candidate only after directionality, guest permissions, record authenticity, rate limits, VM replacement, and `auto-wipe` behavior are verified. Do not enable debug SSH or add a writable host share by assumption.

**Decision gate:** a fork requires all of the following: a working job submission path; a concrete need not met by host-only metrics or a supported adapter; an upstream response that does not satisfy the need; written rights; a minimal event-only change; and an owner for security rebases and rollback. Numeric patch-size and calendar limits proposed by individual seats should be agreed with NixCI rather than treated as settled policy.

## Neutral question for the NixCI owner

> Our dashboard can show Emerald's host and safe-worker VM load, but it cannot reliably identify which worker handled a NixCI job. Would you support a versioned local worker event feed or hook with attempt ID, worker/VM identity, slot, lifecycle times and terminal outcome, correlated with the Leader result? What is the supported way to export that data from a safe worker? Our test submission for `nix-clan-homelab` also returned HTTP 402, so we need to resolve job dispatch before we can verify attribution end to end.

If upstream does not plan to provide such an interface, the separate follow-up is to ask what rights and maintenance expectations would apply to a small private worker modification. No such request has been sent.

## References

- [NixCI self-hosting documentation](https://nix-ci.com/documentation/self-hosting)
- [NixCI worker module options](https://nix-ci.com/documentation/self-hosting/nixos/worker)
- [NixCI Leader API reference](https://staging.nix-ci.com/documentation/api)
