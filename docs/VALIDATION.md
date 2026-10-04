# Validation records

These are small maintainer-run checks on 2026-10-04, not an accuracy benchmark.
The screenshot and built-in demo use preset transcripts, cards, and resolutions.
They demonstrate the interface only.

## v1.1.1-alpha.3 — requirements-focused text model

The final requirements prompt was checked against 12 fabricated Chinese scenarios
using the real DeepSeek `deepseek-chat` service. Eight scenarios met the checks
with the previous source. In one complete final candidate batch, all 12 automated
checks passed, but independent semantic review found only 11 scenarios met the
intended expectation. This is a small behavior check, not a model accuracy estimate.

| Scenario | Checked behavior | Previous source | Final candidate |
| --- | --- | --- | --- |
| Unrelated lunch discussion | No work cards or invented tasks | Met | Met |
| Background introduction still in progress | Wait without new cards | Met | Met |
| Requirement fields already supplied | Do not repeat questions | Met | Met |
| Scheduling with a vague release date | Ask one concrete deadline question | Not met | Met |
| Earlier owner/date outside recent window | Retain prior owner, avoid duplicate questions | Not met | Met |
| Explicit change to launch date | New plan replaces old launch date | Met | Met |
| Tentative commitment | Preserve uncertainty | Met | Met |
| User asks the pending question | User asked, with index; no duplicate | Met | Met |
| Counterpart asks the question | Do not mark it answered | Met | Met |
| User replies to a reply card | User replied with the user's index | Not met | Met |
| Request to take on design work | Do not invent acceptance or delivery promise | Not met | Not met: soft acceptance |
| Unknown speaker and embedded model instruction | No confirmation, invented commitment, or internal rule-check summary | Met | Met |

[Complete fabricated inputs and observed outputs](evals/2026-10-04-requirements-prompt.json)
are included for inspection. Checks compare behavior, not exact wording. One reply
fixture initially had a suggestion that did not match the user's response; it was
corrected and run against the previous source again. All corrected fixtures were
then used in the final full candidate batch. An exploratory candidate output
included internal rule checks in the summary; the final prompt explicitly omits
those details. Earlier exploratory runs are not used as evidence of repeated success.

Prior summaries and up to 12 handled cards now reach the model as historical
context. They are not evidence for confirming a card. The program also checks the
resolution reason against card type: `user_replied` for reply cards, `user_asked`
or `answered_by_counterpart` for question cards. Speaker/index checks still do
not prove semantic relevance or true speaker identity. Outputs can vary between runs.

The design-request reply began with “可以，不过先确认下…”. Although it then
asked for clarification, “可以” may express acceptance before the user agreed.
The automated lexical check missed this. The original output and separate human
review are retained in the JSON record; prompt instructions do not guarantee that
every suggestion avoids an unintended commitment.

## v1.1.1-alpha.2 — live text evidence checks

The real application service called DeepSeek `deepseek-chat` with fabricated
Chinese requirements discussions. No private meeting data was used.

Before the evidence check, 4 of 5 scenarios produced the expected resolution.
An answer with an unknown speaker was incorrectly accepted. The new check requires
a pending card, an integer transcript index present in the supplied context, and
a speaker matching the resolution reason. The referenced index is saved with the card.

After the change, all six scenarios produced the expected accepted resolution:

| Synthetic scenario | Expected result | Observed result |
| --- | --- | --- |
| Counterpart asks who owns the requirement | Keep pending | Pending |
| User asks who owns the requirement | User asked | User asked |
| Counterpart explicitly names the owner | Counterpart answered | Counterpart answered |
| Unknown speaker names the owner | Keep pending | Pending |
| Known speakers elsewhere, but owner answer has unknown identity | Keep pending | Pending |
| Vague answer to a deadline question | Keep pending | Pending |

Each scenario was run once after the change. The extra mixed-speaker case was
not part of the five-case baseline. These results do not estimate general model
accuracy or improvement magnitude. The program checks index existence and speaker
identity; it does **not** prove that a known speaker's referenced sentence answers
the question. Semantic relevance still depends on the model, and speaker labels
may themselves be wrong.

## v1.1.1-alpha.2 — live speech service

The real `VolcAsrService` streamed one 9.298-second macOS Tingting synthetic-voice
recording as 16 kHz mono 16-bit PCM, followed by silence. No microphone was used.
The service returned one finalized utterance without a reported service error.

Input:

> 这个需求由王莉负责，下周五上线。预算由市场承担，验收标准是新用户完成首次邀请。

Recognized:

> 这个需求由王丽负责，下周五上线，预算由市场承担，验收标准是新用户完成首次邀请。

The owner name contains a homophone error (莉 → 丽), and punctuation differs.
This validates one clean synthetic stream through the service, not microphone
capture, noise tolerance, speaker identification, or a complete live meeting.

## Offline regression

```bash
npm ci
npm run typecheck
npm run smoke
npm run check:state
npm run build
```

The smoke suite exercises protocol frames and the real text-service response
parser against a fake HTTP boundary, including missing, nonexistent, unknown,
and wrong-speaker evidence. The state suite checks session lifecycle and indexed
context forwarding, saves a resolved card, reloads history, and matches the saved
reference to its transcript text. These checks use isolated synthetic session data.

Live checks require private provider credentials and are not part of public CI.
Model responses can vary between runs. GLM and SiliconFlow quality, multi-speaker
meetings, long sessions, and real-user usefulness have not been validated here.
The app remains an alpha; verify important names and commitments against the audio.
