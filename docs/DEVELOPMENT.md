# Virgil development

## 从源码运行、检查与打包

```bash
npm ci                   # 安装锁定依赖
node node_modules/electron/install.js  # 下载 Electron 运行时
npm run dev              # 开发模式，热更新
npm run build            # 构建到 out/
npm run typecheck        # 类型检查
npm run smoke            # 离线冒烟：火山二进制帧逐字节校验 + 演示 Copilot 链路
npm run check:state      # 会话状态机回归测试（无头，不碰真实数据）
npm run setup:asr        # 下载本地声纹模型到 vendor/asr/speaker（打包前必须执行）
bash scripts/package-mac.sh   # 打包：产出 release/mac-arm64/Virgil.app + release/Virgil-*.dmg
```

打包需要 Apple Silicon Mac，并须先运行 `npm run setup:asr` 下载声纹模型。开发与演示模式不要求这个模型。

打包完成会得到两样东西：

- `release/mac-arm64/Virgil.app` —— 成品应用本体，双击即可运行（也可以直接拖到 Applications 安装）
- `release/Virgil-<版本>-arm64.dmg` —— 安装盘。双击打开后，把 **Virgil 图标拖进 Applications** 就装好了；镜像里已经放了 Applications 快捷方式，不需要自己去 Finder 里找

> 打包脚本必须在**普通终端**里跑。在受管的沙箱终端里 `cp` 复制 `.asar` 文件会被文件代理拒绝（报 `Operation not permitted`）。

> 如果 shell 里注入了 `ELECTRON_RUN_AS_NODE=1`（某些 Node 工具链会这么做），Electron 会被当成普通 Node 启动并报 `whenReady` 未定义。启动前清掉即可：
> `env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS npm run dev`

### 端到端验证

需要一个正在运行的实例（通过 CDP 真的点按钮、读界面文本，18 项断言）：

```bash
# e2e 会删除会话，务必用隔离的 user-data-dir，不要连自己正在用的实例
env -u ELECTRON_RUN_AS_NODE "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" . \
  --no-sandbox --remote-debugging-port=9222 --user-data-dir=/tmp/virgil-e2e-userdata &
node scripts/e2e-check.mjs
```


## 架构

渲染层只管 UI；主进程三个服务彼此解耦。**硬要求：ASR 不依赖 AI**——文字模型超时/断网/Key 失效时，转录照常工作，Copilot 区显示「暂时不可用」并指数退避重试。

```
src/
  shared/types.ts                  主进程与渲染层共用的数据模型
  main/
    index.ts                       IPC 注册、两个 Key 的 Test、主窗口与悬浮窗
    sessionController.ts           录音/ASR/AI 的编排与状态机
    services/volcProtocol.ts       火山 WS 二进制帧协议（逐字节实现）
    services/asr.ts                火山流式 ASR 客户端
    services/ai.ts                 文字模型三合一调用（总结 + 卡片 + 状态判定）
    services/voiceprint.ts         本地声纹注册与说话人识别（sherpa-onnx）
    services/mockAsr.ts            演示模式驱动
    services/demoScript.ts         演示脚本
    store/settings.ts              Key 存取
    store/sessions.ts              session.json + transcript.ndjson + wav 持久化
    log.ts                         带轮转的追加日志
  renderer/src/
    pages/                         Home / LiveSession / History / Settings
    MiniSession.tsx                Copilot 悬浮窗
    audio/capture.ts               AudioWorklet：麦克风 → 16k/16bit/mono PCM
  preload/index.ts                 contextBridge 暴露的 virgil API
```

音频链路：渲染层 AudioWorklet 降采样到 16k/16bit/mono，每 200ms 一个包经 IPC 送主进程，主进程同时喂给火山 ASR 和本地 wav。


## 贡献

[贡献说明](../CONTRIBUTING.md) · [模型和语音实测](VALIDATION.md) · [第三方许可](../THIRD_PARTY_NOTICES.md)
