# Third-party notices

Virgil source code is MIT licensed. This does not replace third-party licenses.

## Components redistributed in the desktop build

- Electron 44.5.1: MIT, with Chromium and bundled third-party notices distributed
  with the official Electron runtime. Upstream: https://github.com/electron/electron
- React / React DOM 18.3.1 and Zustand 4.5.7: MIT.
  Upstream: https://github.com/facebook/react and https://github.com/pmndrs/zustand
- use-sync-external-store: MIT. Upstream: https://github.com/facebook/react
- ONNX Runtime: MIT, with its own third-party notices. Upstream: https://github.com/microsoft/onnxruntime
- ws 8.22.0: MIT. Upstream: https://github.com/websockets/ws
- sherpa-onnx-node and sherpa-onnx-darwin-arm64 1.13.8: Apache-2.0, with native
  dependency notices retained when present. Upstream: https://github.com/k2-fsa/sherpa-onnx
- 3D-Speaker ERes2Net speaker embedding model, converted to ONNX and distributed
  through sherpa-onnx releases. Upstream project license: Apache-2.0.
  Upstream: https://github.com/modelscope/3D-Speaker
  Model file: 3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx
  Download: https://github.com/k2-fsa/sherpa-onnx/releases/tag/speaker-recongition-models

The packaged app includes the corresponding license files under
`Contents/Resources/licenses/` and this notice under `Contents/Resources/`.
Cloud speech and text-model services are not bundled with Virgil and have their
own service terms and pricing.
