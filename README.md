# Virgil

[![CI](https://github.com/Etan330/Virgil/actions/workflows/ci.yml/badge.svg)](https://github.com/Etan330/Virgil/actions/workflows/ci.yml)

**A real-time conversation copilot for macOS: catch the questions you still need to ask.**

Virgil transcribes conversations, surfaces follow-up questions and suggested replies,
and keeps searchable session history with audio playback. It focuses on requirements
alignment: scope, owners, deadlines, budgets, and acceptance criteria.

- **Try without API keys:** the built-in demo plays a scripted conversation. Its cards
  are scripted too; it demonstrates the interface, not live model accuracy.
- **Run real conversations:** bring a Volcengine speech API key and a supported text-model
  API key (GLM, DeepSeek, or SiliconFlow). Provider usage may incur charges.
- **Platform:** macOS; the existing packaging script targets Apple Silicon (arm64).
- **Audio:** microphone capture. System audio capture is not currently implemented.
- **Data:** recordings and history are stored on your Mac. Live audio is sent to
  Volcengine, and transcript context is sent to your selected text-model provider.
  API keys are currently stored in plaintext locally.
- **Download:** [Apple Silicon alpha DMG](https://github.com/Etan330/Virgil/releases/tag/v1.1.1-alpha.1). Builds are ad-hoc signed, without a Developer ID or notarization.

```bash
npm ci
node node_modules/electron/install.js
npm run dev
```

Use **演示模式** on Home to try the scripted demo without keys.
The current interface is primarily Chinese.

Contributions and concrete usage feedback are welcome. If Virgil is useful to you,
consider starring this repository so you can find it again.

[Contributing](CONTRIBUTING.md) · [Report a bug](https://github.com/Etan330/Virgil/issues/new/choose)

---

## 中文说明

macOS 桌面端的实时对话 Copilot。开会时它替你听着：把你和对方说的话转成文字、分清谁在说、实时提炼要点，并在该追问或该回应的时候递上一句话。散会后，整场对话连录音一起留在本地，可以回看、搜索、重命名。

一句话概括这个闭环：**听见 → 理解 → 提醒 → 沉淀**。

---

## 一、它长什么样

四个页面，加一个悬浮窗：

| 页面 | 干什么 |
|---|---|
| **Home** | 一个 Start 按钮。两个 Key 没配好时会拦住你并指向 Settings。右上角另有独立的「演示模式」 |
| **Live Session** | 左边实时转录 + 实时总结，右边 Copilot 卡片（待处理 / 已处理）。支持暂停/继续，可收起成悬浮窗 |
| **History** | 所有历史会话。全文搜索（标题/转录/总结/Copilot）、重命名、删除，点任意一句可跳到录音对应位置播放 |
| **Settings** | 左栏配语音与文字模型，右栏登记你的声音 |

**Copilot 卡片**只有两类：

- **该问**（need_to_ask）：缺了就没法往下推的信息——deadline、负责人、范围、预算、验收标准
- **这么回**（suggested_reply）：对方刚说了观点/承诺/风险/请求，你该接一句

卡片变绿打 ✓（Confirmed）只有两种情形：① 你把语义相同的问题问出了口；② 对方没等你问就主动给了答案。你手动点「不需要」会标为已忽略。**卡片不会自动过期**——没判定的会一直留在待处理里等你回看，不会凭空消失。

---

## 二、下载与运行

[下载 Apple Silicon 预览版 DMG](https://github.com/Etan330/Virgil/releases/tag/v1.1.1-alpha.1)，打开后把 Virgil 拖到 Applications。应用未做 Developer ID 签名与公证；如果 macOS 阻止启动，在系统设置 → 隐私与安全性中确认来源后允许打开。

打开 Home 的「演示模式」即可免 Key 看交互。真实运行需要在 Settings 配置两个供应商 Key。

开发者从源码运行：

```bash
npm install              # 装依赖（含 Electron 二进制）
npm run dev              # 开发模式，热更新
npm run build            # 构建到 out/
npm run typecheck        # 类型检查
npm run smoke            # 离线冒烟：火山二进制帧逐字节校验 + 演示 Copilot 链路
npm run check:state      # 会话状态机回归测试（无头，不碰真实数据）
npm run setup:asr        # 下载本地声纹模型到 vendor/asr/speaker（打包前必须执行）
bash scripts/package-mac.sh   # 打包：产出 release/Virgil.app + release/Virgil-*.dmg
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

---

## 三、怎么配：两个 Key + 一次录音

供应商是预置卡片，**Base URL、接口协议、模型 ID 全都写死在预设里**，你只负责选一家、填 Key、挑模型。

| 环节 | 供应商 | 需要 Key | 可选模型 |
|---|---|---|---|
| 语音识别 | 火山引擎 · 豆包流式 2.0（bigmodel） | 是 | `volc.seedasr.sauc.duration`（小时计费，已预填） |
| 文字模型 | **智谱 GLM（出厂默认）** | 是 | `glm-4.7-flash`（默认）/ `glm-4-flash` |
| 文字模型 | DeepSeek | 是 | `deepseek-chat` / `deepseek-reasoner` |
| 文字模型 | 硅基流动 | 是 | `Qwen2.5-7B-Instruct` / `Qwen3-8B` |

各供应商的可用模型、额度和费用以其当前规则为准。

每家的 Key 分开保存，来回切换不会丢。填完点 **Test** 验证，再点 **Save**。

**声纹登记**（可选，但强烈建议）：Settings 右栏点开始，照着引导句读满 5 秒。之后每句话自动比对——像你的标「我」，不像的按声音自动聚成「TA / TA2 / TA3」。模型是本地的 3D-Speaker ERes2Net（中文，39.6MB），第一次用 `npm run setup:asr` 下载；不登记也能用，只是说话人会退回停顿启发式。

> **一个 Key 都不想填也能看效果**：Home 右上角「演示模式」会回放一段需求对齐的脚本对话，Copilot 卡片和状态流转都能看到。**演示会话同样会生成一段等长的静音录音**，所以 History 里的播放器、时钟、点某一句跳到录音对应位置，都和真实会话一模一样（只是听不到声音）。Start 与演示完全分离——Start 永远走真实链路。

---

## 四、数据落在哪

全部在本机 `~/Library/Application Support/virgil/`：

| 文件 | 内容 |
|---|---|
| `settings.json` | 两家 Key 与模型选择。**明文保存**（与 Claude Code 的 settings 文件同一思路：单人本机应用，换来的是不再弹钥匙串授权框） |
| `sessions/<id>/session.json` | 会话元数据、总结、Copilot 卡片 |
| `sessions/<id>/transcript.ndjson` | 逐句追加的转录，崩溃安全 |
| `sessions/<id>/audio.wav` | 16k/16bit/mono 录音。**约 1.83MB/分钟，一场 1 小时的会议约 110MB** |
| `voiceprint.json` | 声纹向量 |
| `logs/` | 主进程与渲染层日志，单文件 5MB 后轮转 |

录音不做压缩也不自动清理——它支撑着「点某一句跳到录音对应位置」这个能力，代价是磁盘占用会随会话累积，需要时手动删掉旧会话即可。

---

## 五、架构

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

---

## 六、已知边界

- **未做代码签名与公证**：自己打包自己用没问题；发给别人时对方首次打开需右键 → 打开，或 `xattr -cr /Applications/Virgil.app`。
- **断句节奏由火山 VAD 决定**，不在本地控制。
- **多人同时说话（重叠语音）无法分离**，会归到同一个说话人。
- **声纹目前只登记「我」一个人**：其余人靠声音聚类成 TA / TA2 / TA3，不认名字。
- **录音体积随会话线性增长**，没有自动清理策略。
- 火山 `bigmodel_async` 不支持 `language` 参数，中英文自动识别。
- 演示模式是固定脚本回放，转录、建议和确认均预设，不代表真实识别或模型效果。
- 说话人标签可能误识别；没有登记声纹或语句过短时，停顿启发式不等于可靠说话人识别。
- AI 分析使用最近约 8,000 字的对话上下文；早期决定可能不出现在最新摘要中。历史转录保留，可用于回查。
- 自动卡片判定是模型建议，应结合原话检查；「你已问出」不等于「对方已回答」。

## License

Virgil source code is available under the [MIT license](LICENSE). Third-party dependencies and downloaded models retain their own licenses.
