# Taste

## Tooling

- Use `bun` as the JavaScript runtime instead of `node` — it is what the user has installed (bun 1.4.2; node is not installed on this machine). Applies to syntax checks, script execution, and any JS tooling need. Confidence: 0.95

## Workflow

- Plan before writing code on substantial tasks: finish the planning step first (architecture, file map, contracts, verification steps) and get the plan approved before implementing. The user interrupted an agent that had started coding ahead of planning, saying "we have to do with proper planning", and expects the original task to be restated/confirmed when asked. Confidence: 0.9
- When porting/rewriting existing code, keep behavior 1:1 (known bugs included) and document them in a KNOWN-ISSUES-style file instead of silently fixing — chosen over "fix obvious crashes" for the gui v2 rewrite. Confidence: 0.65
- HTTP/bundle-level checks are not sufficient to declare a UI task done: the v2 GUI rewrite passed curl endpoint checks (200s on every asset) and clean bun bundling, yet the user immediately replied "it's buggy" with a screenshot. Verify the rendered UI in a real browser (visual state + interactions) before reporting success. Confidence: 0.7

## Communication

- Bug reports arrive terse and visual: a screenshot plus minimal text ("it's buggy"), with no repro steps. Diagnose from the attached image/visual evidence rather than asking the user for details. Confidence: 0.6
