# Virgil roadmap

Virgil helps people notice missing questions during requirements discussions.
The current app is primarily Chinese and captures microphone audio on macOS.
This list describes intended work, not shipped features or delivery promises.

## Release foundation

- [x] Public source repository with an MIT license and contribution instructions.
- [x] Apple Silicon alpha download, installation instructions, and reproducible checks.
- [x] Clearly labeled scripted demo screenshot.
- [ ] Consented real-session example.

## Next product experiments

- Show which requirements are explicit or still missing: scope, owner, deadline,
  budget, and acceptance criteria. Link each conclusion to transcript evidence.
- Validate card resolution strictly: asking a question and receiving an answer are
  separate outcomes; malformed model responses must not mark a card resolved.
- Measure suggestion usefulness, duplication, false resolution, and latency in
  real sessions before expanding provider or platform support.
- Investigate system-audio capture if remote-call users are the main audience.

## Contributions welcome

Useful starting points include improving onboarding documentation, reporting
reproducible installation issues, and suggesting anonymized requirements scenarios.
Please describe a concrete user need before implementing a large feature.
