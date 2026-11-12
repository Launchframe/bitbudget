---
name: real-steel
description: Multi-model adversarial PR review chain — sequential reviewer passes (ChatGPT, Claude Sonnet, Composer, etc.) each review the PR, post comments, apply fixes, and challenge prior reviewers' assumptions. Use when the user says /real-steel, real-steel, multi-model review, or wants Copilot-style PR review with multiple model perspectives on the current branch.
disable-model-invocation: true
---

# Real Steel — multi-model PR review

Adversarial, sequential PR review: each model pass **reviews the branch**, **posts PR comments**, **implements valid fixes**, and **critiques prior passes**. Pit model intuition against model intuition.

Read [AGENTS.md](../../../AGENTS.md) (privacy, tests, PR comment replies). Do **not** resolve review threads unless the maintainer asks.

## Worktree isolation

Follow [`.cursor/rules/agent-git-hygiene.mdc`](../rules/agent-git-hygiene.mdc): review in the **primary clone** by default. Fall back to `./scripts/new-worktree.sh` and `move_agent_to_root` **once** only if the maintainer asks, or if colliding sessions / foreign dirty WIP would clobber the shared tree — ask when unsure.

## Invocation

```
/real-steel <alias> [<alias> ...]
```

**Example:** `/real-steel chat sonnet composer`

| Alias                             | Model (Task `model` param)          | Persona label |
| --------------------------------- | ----------------------------------- | ------------- |
| `chat`, `gpt`, `chatgpt`, `codex` | `gpt-5.5-medium`                    | ChatGPT       |
| `sonnet`, `claude`                | `claude-4.6-sonnet-medium-thinking` | Claude Sonnet |
| `composer`                        | `composer-2.5-fast`                 | Composer      |
| `opus`                            | `claude-opus-4-7-thinking-xhigh`    | Claude Opus   |

Unknown aliases → stop and ask. Duplicate aliases in one chain → allowed (e.g. explicit closing `chat`).

### Closing post-mortem pass (default)

When the chain has **2+ aliases** and the **last alias is not the same model as the first**, append one final pass using the **first** model in **post-mortem mode**:

`/real-steel chat sonnet composer` → **chat → sonnet → composer → chat (post-mortem)**

Post-mortem pass must:

- Review the full PR + all commits from earlier passes
- If **this model's earlier fixes were wrong** and a later pass corrected them: explain the faulty reasoning and how to avoid it next time
- Only post new fixes if something is still broken; do not churn working code

If the user ends the chain with the same alias as the first (e.g. `... composer chat`), treat that final token as the post-mortem pass — do not append another.

## Orchestrator (parent agent) duties

You coordinate; you do **not** skip passes or collapse them into one review.

1. **Resolve PR** — current branch → `gh pr view --json number,url,title,baseRefName` (create PR first if missing).
2. **Merge parent onto the feature branch (required before first pass)** — reviewers read **remote** branch state. Integrate the latest parent with a **merge**, never a rebase, **before** the first pass:
   - `git fetch origin`
   - Ensure the checkout includes the latest **remote feature branch** first: `git merge origin/<headRef>` (fast-forward or merge commit). **Do not** `git reset --hard` onto a stale local tip; **do not** rebase. A stale local checkout plus a later force-push **destroys** remote commits the local branch did not have.
   - `git merge origin/<baseRefName>` (no-op is fine if already up to date)
   - **Merge conflicts:** high-confidence resolves only; otherwise **stop**, summarize, `git merge --abort` if leaving the tree dirty, and **await direction**.
   - **Publish with a regular push only** if the merge created a commit. **Never** `git push --force`, `--force-with-lease`, or any other force push. If the remote advanced, `git pull --no-rebase` (merge) and push again.
3. **Baseline** — note `origin/<base>...HEAD` diff after the merge, open/unresolved review threads (`gh api graphql`).
4. **Run log (local only)** — append to `.cursor/real-steel/pr-<number>-<YYYYMMDD>.md` (create dir if needed): pass order, model, commits, comment URLs, findings, merge notes. **Do not commit run logs or review write-ups** — those belong on the PR via `gh`, not in the repo (see **Git and PR rules**).
5. **For each pass in order** — launch a **Task** subagent (see below). **Wait for completion** before the next pass.
6. **After each pass** — verify `pnpm lint` + scoped `pnpm test` (full suite before declaring done). Push if the pass committed (**regular push only** — never force-push).
7. **Final summary** to the user: pass table, remaining risks, link to run log, CI status, merge/push status.
8. **Apply `real-steel-ready` label** — once the full chain (including post-mortem) is complete and the post-mortem has been posted on the PR, apply the `real-steel-ready` label to the PR using `EditPullRequestLabels`. This signals to future agents that the PR has been through the full adversarial review gauntlet.

Pass subagents **sequentially**, never in parallel — each pass depends on the prior branch state.

## Pass subagent prompt (template)

Launch with `Task`, `subagent_type: generalPurpose`, explicit `model` from the alias table, and `readonly: false`.

Include in every pass prompt:

- PR number, URL, base branch
- **Parent is merged into the feature branch (no rebase, no force-push)** — review remote `HEAD`, including any remote feature-branch commits that were ahead of local
- Path to run log
- List of prior pass summaries (from run log)
- `AGENTS.md` must be followed (encryption, ledger, tests, mobile UI)
- Scope: **PR diff only** — no drive-by refactors

**Standard pass (`mode: review`):**

1. Read PR description + full diff (`git diff origin/<base>...HEAD`)
2. Read prior pass notes in run log; explicitly **validate or reject** earlier fixes
3. Post review feedback on the **PR** via `gh api graphql` (`addPullRequestReviewThreadReply` or inline review as appropriate). **Do not resolve threads.** **Do not** duplicate review comments into committed markdown files — the PR is the source of truth.
4. Implement **valid** fixes; add/update Vitest when logic changes
5. Commit **code/test fixes only**: `real-steel(<persona>): <short summary>` — never include `.cursor/real-steel/` run logs in the commit
6. Push to PR branch
7. Append pass report to the **local** run log (untracked): findings, fixes, disagreements with prior passes

**Post-mortem pass (`mode: postmortem`):**

Same as above, plus **required section** in run log and user-visible summary:

```markdown
## Post-mortem (<persona>)

- Earlier mistakes by this model: ...
- Why the reasoning was wrong: ...
- How to avoid next time: ...
- Still open: ...
```

If this model had no earlier pass in the chain, post-mortem is a normal final review only.

## Review focus (every pass)

- Correctness, security, privacy (no plaintext secrets / decrypted data in logs)
- AGENTS.md violations (ledger toggle, month-scoped "Remaining", encryption)
- Missing tests for non-trivial `lib/` changes
- Mobile layout (`min-w-0`, no horizontal page scroll)
- Prior pass regressions or overfixes

Severity in comments: **Critical** / **Suggestion** / **Nit**.

### Reviewer rigor — non-negotiable

**Fix what you find. Do not kick risks to the next pass.**

Every detected issue must be either (a) **fixed in this pass** or (b) explicitly handed off with a clear written reason why it cannot be fixed here (e.g. requires schema migration, out of PR scope). "Low risk" and "worth fixing later" are not valid reasons to leave a known bug in the branch.

**Severity escalation rule:** When uncertain whether a risk is low or medium, **call it medium**. When uncertain between medium and high, **call it high**. The goal is a spotless PR — under-labelling risk causes known bugs to survive review.

**Fix priority order within a pass:**

1. **Correctness / data-integrity bugs** (crashes, data loss, inconsistent DB writes, security holes)
2. **Behavioral bugs** (wrong output, edge-case failures, missing error handling)
3. **Test gaps** for non-trivial logic
4. **Code conventions** (naming, type accuracy, dead code, AGENTS.md style)
5. **UI / style nits**

Work top-down. Do not spend tokens on nits while correctness bugs remain unfixed.

**No deferred risk without evidence.** If you write "worth a `$transaction` if correctness guarantees are needed" or "low-risk because X is rare," you must also explain specifically why you are **not** fixing it in this pass. Absence of justification = oversight, not a deliberate decision.

## Git and PR rules

- **Never force-push** any branch during Real Steel — not `main`, not the feature branch. `--force` and `--force-with-lease` are forbidden.
- **Never rebase** the feature branch onto the parent. Merge `origin/<baseRefName>` into the feature branch instead, then regular-push. Integrate the latest `origin/<headRef>` **before** merging the parent so a stale local checkout cannot drop remote commits.
- Commit after each pass that changes **product code or tests** (reviewable history)
- **Never commit Real Steel artifacts** — `.cursor/real-steel/*.md` run logs are orchestrator scratch space only. Review comments, findings, and post-mortems go on the PR via `gh`, not into the branch. Before every commit/push, confirm `git status` does not stage `.cursor/real-steel/` (add that path to `.gitignore` if missing).
- Do not amend prior pass commits unless hook requires it
- User must approve pushes if branch policy requires it; otherwise push after each pass for CI signal

## When to stop early

Stop and report to the user if:

- A pass finds **no valid issues** and makes **no code changes** (note "clean pass"; continue chain unless user said stop-on-clean)
- CI is red for reasons **outside PR scope** — report, do not weaken CI
- **Merge conflicts** you cannot resolve with **high confidence** — summarize, prompt maintainer, **await direction** (do not start reviewer passes on a conflicted or unpublished merge). Never rebase or force-push to “fix” conflicts.

## Examples

| User says                          | Chain                                               |
| ---------------------------------- | --------------------------------------------------- |
| `/real-steel chat sonnet composer` | ChatGPT → Sonnet → Composer → ChatGPT post-mortem   |
| `/real-steel sonnet`               | Sonnet only (single pass)                           |
| `/real-steel chat composer chat`   | ChatGPT → Composer → ChatGPT post-mortem (explicit) |
| `/real-steel opus sonnet composer` | Opus → Sonnet → Composer → Opus post-mortem         |

## Anti-patterns

- **Committing run logs** — `.cursor/real-steel/` is local-only; duplicating PR review text in markdown on the branch pollutes history and may leak stale findings
- **One agent pretending to be three models** — always use separate Task invocations with distinct `model` slugs
- **Parallel passes** — later reviewers must see earlier commits
- **Resolving PR threads** — maintainer grooms threads
- **Mega-commit at end** — loses attribution per reviewer
- **Skipping tests** — each pass that edits code runs lint + relevant tests
- **Soft-pedaling risks** — describing a known bug as "low-risk," "worth fixing later," or "fine for now" without immediately fixing it. If you found it, fix it this pass or explain why you cannot. Deferral without justification is a review miss, not a deliberate call.
- **Rebasing or force-pushing** — rewriting history then `push --force` / `--force-with-lease` destroys remote feature-branch commits that local did not have
- **Skipping `real-steel-ready` label** — forgetting to apply the label after a complete chain leaves the PR indistinguishable from one that has never been reviewed

## Related skills

- **babysit** (Cursor built-in) — merge-ready triage after Real Steel (CI loop, existing comments)
- [feature-slice](../feature-slice/SKILL.md) — if the PR is too large to review, split first
- [ledger-feature](../ledger-feature/SKILL.md) — mandatory for envelope/Savings/funding diffs