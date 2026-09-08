# UI overhaul agent handoffs

This directory is the ordered, persistent handoff channel for the UI overhaul.

1. `01-requirements.md` — product/UI requirements and resolved ambiguities.
2. `02-technical-design.md` — implementation-ready component/state/CSS plan.
3. `03-implementation.md` — files changed, behavior preserved, verification run.
4. `04-code-review.md` — review findings and required remediation.
5. `05-qa.md` — browser QA scenarios, results, and remaining issues.

Every phase must read all preceding files, update its own file, and leave the
working tree in a state the following phase can inspect. Agents must not edit
application behavior: server protocol and game-rule outcomes remain unchanged.
