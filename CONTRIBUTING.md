# Contributing to Virgil

Start with a small, focused change and describe the user problem it solves.
For larger changes, open an issue first so we can discuss the intended behavior.

## Development

```bash
npm ci
npm run dev
```

For speaker identification, download the optional model with `npm run setup:asr`.
The scripted demo needs no provider API keys or model download.

Before opening a pull request, run:

```bash
npm run typecheck
npm run smoke
npm run check:state
npm run build
```

Include the behavior change and your validation results in the pull request.
Use fabricated or consented, anonymized examples. Never include API keys, private
recordings, transcripts, or local settings files in issues or pull requests.

The source code is MIT licensed. Dependencies, downloaded models, and third-party
assets retain their own licenses; verify their terms when redistributing binaries.
