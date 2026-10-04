# Validation record — v1.1.1-alpha.2

These are small maintainer-run checks on 2026-10-04, not an accuracy benchmark.
The screenshot and built-in demo use preset transcripts, cards, and resolutions.
They demonstrate the interface only.

## Live text model

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

## Live speech service

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
