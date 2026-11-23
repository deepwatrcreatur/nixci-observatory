# Round 1: Proving Emerald Worker Activity

**Status:** first-pass complete; implementation conditions remain open
**Date:** 2026-11-23
**IC:** Codex (current session)
**Scope:** evidence of work performed by Emerald's self-hosted NixCI safe worker, attribution of completed jobs, useful load metrics, and the operator dashboard.

## Roster

- Codex CLI
- Gemini CLI (`agy`)
- Claude CLI
- GitHub Copilot CLI
- DeepSeek API

Each seat receives the same prompt below. Seats are real CLI/API responses; an unavailable or empty seat will be identified rather than synthesized.

OpenCode free-model enrichment was considered but not run: the available plan agent allows tools, and no tool-free isolated profile is configured for this round.

### Run record

| Seat | Invocation | Result |
| --- | --- | --- |
| Codex | `codex exec` with read-only sandbox, from `/tmp` | Substantive response; all five question markers present. |
| Gemini | `agy -p`, plan mode | First attempt failed because the sandbox server reset. Retried without that wrapper; substantive response returned with all markers. |
| Claude | `claude -p`, plan mode, tools disabled | Substantive response returned in plan-style output; summarized below. No repository or live-host edits. |
| GitHub Copilot | `copilot -p`, empty available-tools list, built-in MCP disabled | Substantive response; all markers present. An initial invalid wildcard deny-tool flag was discarded and retried. |
| DeepSeek | Direct DeepSeek API request, model `deepseek-chat` | Substantive response with all markers. Its response heading incorrectly identified itself as “Codex CLI”; it is attributed here to the actual DeepSeek API invocation. |

The five seats addressed the same prompt. Raw response files were temporary working artifacts and are not part of this archive; this note preserves their distinct positions and the synthesis.

## Shared prompt

You are a participant in a design round for `nixci-observatory`. Give an independent, critical design position based only on the evidence below and your technical knowledge. Do not edit files, contact the NixCI provider, make live host changes, or claim that an unobserved build happened. Separate direct evidence from inference. Identify what evidence is required to attribute a job to Emerald.

### Current system and verified evidence

- The app is a read-only Python standard-library web server, bound to `127.0.0.1:8092` by default. Its warm-light dashboard has theme switching, host CPU/memory/load/disk, process names without command arguments, the safe worker service/cgroup CPU and memory, and GitHub/NixCI suite history. Suite records do not expose worker identity.
- On Emerald, the safe worker runs as a QEMU VM under `nix-ci-production-worker-emerald-worker-1.service`. The unit was active with zero restarts at the last inspection. The VM is configured for 12 cores and 48 GiB, one worker slot, and `auto-wipe = true`; the worker guest is isolated from the home LAN. The dashboard's cgroup CPU and memory measure resource use by the VM service on Emerald, but cannot alone prove that a NixCI build is running.
- The current NixOS configuration shares the worker credential directory into the guest. It does not enable the documented VM debug SSH option or expose the guest's job records to the host.
- NixCI's public worker module documentation describes `slots-base` as the base directory for per-slot `job.json` records, defaulting to `/run/nix-ci/slots` inside the guest. It documents optional debug SSH settings for connecting to the guest. The JSON schema and lifecycle semantics have not been verified here.
- The published Leader API reference documents `POST /suite` and `GET /suite/{uuid}/wait`; it does not document a worker-assignment endpoint. Public GitHub status/NixCI suite pages expose suite/job status but no worker identity.
- An explicit suite submission for `nix-clan-homelab` returned HTTP 402 stating builds are not running for that repository, so that attempt never started. Do not mistake the active worker service or a pending/public suite status for a build performed by Emerald.
- The maintainer requires Emerald to remain online. During this design round: no generation activation, boot-default change, reboot, service restart, live host configuration change, secret exposure, or provider contact.

### Questions

**Q1 — Attribution and proof.** What is the strongest practical evidence that a named job actually ran on Emerald? Compare a guest-local slot/job record, worker-side journal or Nix daemon evidence, NixCI API/status attribution, and resource correlation. State which evidence supports `claimed`, `running`, `completed`, and `succeeded`.

**Q2 — Safe architecture.** Propose the smallest trustworthy path to expose job activity without weakening the safe-worker isolation or persisting tenant state across wipes. What should be collected inside the guest, how should it reach the host, and which identity/timestamps/exit facts must be bound together? Identify unknowns that must be checked against the installed worker version before implementation.

**Q3 — Metrics and UI.** Recommend high-value current and cumulative metrics for both Emerald and the worker: CPU, memory/peak, disk and network I/O, build/derivation counts, queue/slot state, cache hits or store additions where measurable. Define units, intervals, baselines, and caveats. Suggest a calm, readable btop/nh-inspired layout and how job trees should avoid inventing dependency edges.

**Q4 — Evidence, privacy, and failure modes.** How should the UI distinguish direct evidence from inference, handle stale/missing/contradictory telemetry, and avoid exposing tenant data, secrets, full build logs, or misleading “success on Emerald” claims?

**Q5 — Implementation sequence.** Give a phased plan that improves value now using existing host telemetry, then adds job-level attribution only when a safe, supported feed exists. Include acceptance criteria and the single most important open question for the NixCI maintainer, without contacting them.

For each question, end with exactly one applicable marker: `[satisfied]`, `[satisfied-conditional: ...]`, or `[needs more evidence: ...]`. State what evidence would resolve any conditional or unmet marker. Keep the response focused and make meaningful disagreements explicit.

## Voice summaries

### Codex CLI

- A guest record is only a candidate until its meaning in the installed worker version is verified. A job specification being present does not by itself prove that its runner started.
- Require a stable job and attempt ID, a worker execution-start event, and a terminal outcome tied to the Emerald VM invocation. Cross-check provider outcome separately.
- Resource totals should be labelled as VM-level. Do not call them per-job cost or proof of a build. Keep the job tree to source-reported suite, job, and attempt relationships.
- Preferred a bounded guest-to-host event path if the safe-worker module supports one; keep debug SSH off.

### Gemini CLI (`agy`)

- Ranked public suite state and host cgroup activity below a guest execution record for placement proof. Recommended separate lifecycle and resource panels.
- Proposed a one-way serial event stream from a small guest exporter; explicitly rejected debug SSH and writable host mounts as the default path.
- Offered detailed CPU, memory, disk, network, slot and cache metrics. The response speculated that `job.json` itself carries states and start/finish times, although the prompt explicitly said its schema was unverified. That claim, suggested idle baselines, and ideas such as inferring cache activity from network bursts are hypotheses, not evidence; implementation must not present them as facts.
- Asked whether the worker has a supported lifecycle stream or whether the slot file is the only interface.

### Claude CLI

- Emphasized that “job succeeded” differs from “Emerald's attempt succeeded” when jobs retry elsewhere; attribution must be attempt-scoped.
- Noted that cgroup activity can include QEMU overhead, guest housekeeping or fetching, and that memory remaining high is not proof of a running build.
- Recommended a worker-side lifecycle event plus public-status cross-check, bounded fields, freshness, and explicit unknown states. Opposed debug SSH as a telemetry path.
- Suggested local CPU, memory-peak, I/O and pressure metrics where the host actually exposes those counters.

### GitHub Copilot CLI

- Recommended source badges (`host cgroup`, `guest record`, `NixCI status`) and stale/conflict states. It would reserve “succeeded on Emerald” for a matching worker attempt and provider result.
- Proposed a minimal exporter for slot identity and timestamps, but warned that reuse of the existing credential share is not proven safe for telemetry.
- Recommended keeping guest records out of the browser and exporting only a bounded, allowlisted schema.
- Its main open question was whether the installed slot record contains the same attempt identity as public NixCI status, and whether its lifecycle is safe to observe across wipe/reuse.

### DeepSeek API (`deepseek-chat`)

- Treated a slot record plus provider status as the best correlation, with host cgroup CPU as corroboration only. It also called out the need for a guest boot ID and sequence number to expose gaps and VM replacement.
- Recommended host-side freshness, reset, and contradiction indicators, and keeping “succeeded on Emerald” unavailable until both sides match.
- Proposed reusing a read-only share or guest-agent file read if present. This differs from the other seats' stronger preference for a one-way event channel; neither mechanism is verified in the current configuration.

## Synthesis

**Convergence:** all five seats rejected service-active state, suite status alone, and cgroup activity as proof that a named build ran on Emerald. Their common proof rule is a worker-side execution record for a specific attempt, bound to this VM instance and cross-checked against NixCI's outcome for that same attempt. A successful suite must not imply a successful Emerald attempt when retries or multiple workers are possible.

The UI should keep three evidence streams distinct:

1. **Emerald host:** CPU, memory, load and disk/network counters, with units and sample age.
2. **Safe worker VM:** service state, restarts, cgroup CPU time/utilization and memory current/peak; expose I/O only when accounting maps reliably to this VM. These are direct host measurements of the VM, not job attribution.
3. **NixCI:** suite/job statuses and links from the provider. These are provider outcomes, not worker placement.

When a trustworthy worker feed exists, add per-slot state and attempt history with event source, VM boot/invocation identity, sequence, event time and host receipt time. Distinguish `claimed`, `running`, `completed`, and `succeeded`; preserve cancellation, failure, unknown and stale states. Count derivations, substitutions, or cache hits only when their local source and denominator are known. Label CPU or I/O over an attempt window as **VM resource use during that attempt**, not as isolated job cost.

Use a provenance label and last-observed age for each stream. Missing data is `unknown`, not zero. A stale event or a lost VM invocation must never leave a slot looking current. Contradictory worker and provider outcomes should remain visible and suppress an attributed-success badge. Keep the existing warm, dense layout; use suite → job → attempt nesting only where records supply those relationships, and show derivation edges only if a verified dependency graph supplies them.

**Unresolved design choice:** the seats proposed serial/vsock-style one-way events, a read-only share, or a guest-agent read. They did not establish that any of these is available or safe in this deployment. Inspect the installed worker version and QEMU module before selecting a channel; do not turn on debug SSH or add a writable host mount by assumption.

**Implementation direction:** improve provenance, units, freshness and explicit unknown states with existing host telemetry first. Then verify the installed worker's job identity and lifecycle source offline, design a bounded export that preserves guest isolation and `auto-wipe`, test gaps/retries/wipes with fixtures, and only then consider a separately approved live trial on a repository that is allowed to build. The earlier HTTP 402 attempt is not such a trial.

## Open questions

- Which worker-side event establishes that execution actually started, and which terminal event carries its outcome?
- Does the installed worker expose a stable **attempt** ID that can be matched to public NixCI status?
- Which guest-to-host channel preserves the safe-worker boundary and survives short jobs without losing the final event?
- Can local Nix store activity be attributed to an attempt, and which counters can be exposed without tenant paths or logs?
- Which repository/account can run an explicitly identified test job, given the earlier HTTP 402?

The discussion direction is converged but conditional: until these questions are verified, the page should present VM load and NixCI activity separately and make no “built on Emerald” claim.

## References

- [NixCI self-hosting documentation](https://nix-ci.com/documentation/self-hosting) — states that NixCI is not open source and documents worker self-hosting.
- [NixCI worker module options](https://nix-ci.com/documentation/self-hosting/nixos/worker) — documents the slot-record base path and optional guest debug access.
- [NixCI Leader API reference](https://staging.nix-ci.com/documentation/api) — documents suite submission and waiting; no worker-placement operation is listed there.
