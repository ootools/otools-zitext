# otools-zitext

把 [ZITEXT Editor](https://github.com/zitrino-oss/zitext-editor) 移植成 **OTools 独立插件**：
完整保留上游的 React 19 + Monaco 编辑器前端，把 Tauri v2 的 Rust 后端换成 OTools 宿主
提供的 webview API（`window.otools`）。纯前端、无 Rust、无网络请求、无账号。

- 上游：`zitrino-oss/zitext-editor` @ `2a11efcb22be0585bccc6a037e6f9f7228b4a441`（Apache-2.0）
- 插件：`otools-zitext`，版本见 `plugin.json`
- 宿主要求：OTools ≥ 0.9.0

## 功能

上游的所有界面能力原样保留：多标签、分屏、80+ 语言高亮、多光标与列选择、查找替换、
Marks 高亮、文件比较、Markdown 预览、JSON/XML/YAML 与文本数据工具、大文件/日志查看器、
Scratchpad、崩溃恢复、大文件警告与主题/字体设置。

| 上游能力 | 插件版实现 |
| --- | --- |
| 文件读写 / 目录树 / 文件元数据 | `readHostFile` / `writeHostFile` / `listHostDir` |
| 打开、打开文件夹、另存为对话框 | 宿主 SDK 的页面内 DOM 树（`pickFromHostTree`），返回本机真实路径 |
| 确认/提示对话框、剪贴板、外链 | 宿主 dialog、Clipboard API、`shellOpenExternal` |
| settings.json / session.json / scratchpad / recent files | 宿主文件 `~/.otools/local/otools-zitext/kv-*.json`（IndexedDB / localStorage 兜底） |
| 大文件日志查看器 | 宿主一次读入后在 webview 内建行索引、过滤、搜索、导出（≤256 MB） |
| 原生菜单、窗口标题/全屏、CLI 启动参数 | 宿主接管；`otools_consume_open_files` 对接「打开方式」 |
| 在线更新检查 | 关闭，由 OTools 插件市场统一发布 |

### 相对上游的三处增强

1. **记住上次打开的标签页**：上游的会话快照只是崩溃恢复，且状态存在 web 存储里；
   插件页跑在宿主的 `otools-plugin://` 自定义 scheme 上，那里 IndexedDB / localStorage
   并不保证可用，写入失败是静默的（症状就是「重启后标签全没了」）。现在状态落在
   宿主文件 `~/.otools/local/otools-zitext/kv-session.json`，快照间隔也从 30s 收到 10s，
   正常退出再启动会把上次的标签页、未保存草稿和光标位置一起带回来。
2. **同时打开多个文件夹**：侧栏支持多个根目录。菜单「打开文件夹」或侧栏的
   ➕ 会**追加**一个根（不再替换），每个根独立加载/刷新/报错，可用 × 单独移除；
   过滤与文件计数跨根聚合，根列表随工作区一起持久化。
   *已知限制*：Find in Files 仍只搜索主根（它挂在 App 上，改动会牵到上游 2000 行的
   `App.tsx`）。
3. **文件选择框的隐藏文件开关**：`otools-plugin-sdk` 的 `pickFromHostTree` 增加了
   `showHidden` 选项与页脚「显示隐藏文件」勾选框，默认关闭（`.git`、`.env` 这类
   条目先藏起来），切换只重画当前目录、不重新读盘。

## 目录结构

```
upstream/            上游前端原样快照（不要就地改，upstream.lock.json 有内容哈希）
shell/
  shim/              @tauri-apps/* 的替身：core/event/window/app/dialog/clipboard
    backend/         fs.ts / state.ts / largeFile.ts：Rust 命令的 webview 实现
    host.ts          OTools 宿主 / 浏览器虚拟 FS 的统一后端抽象
    hostStore.ts     宿主文件里的键值存储（设置/会话/工作区根，web 存储兜底）
  src/               覆盖/新增的上游文件（多根目录侧栏、关闭在线更新检查）
  tests/             移植层回归测试
  index.html         插件入口（相对路径资源 + OTools 标记）
  vite.config.ts     alias + base:'./'（宿主用 otools-plugin:// 加载）
scripts/             合成构建树、构建、测试、打包、校验、发布、上游同步
vendor/              宿主 SDK 的 dist 快照（otools-plugin-sdk，选目录用的 DOM 树）
.github/workflows/    release-plugin.yml（tag v* 触发）
dist/                构建产物（提交进仓库，方便子模块直接安装）
```

`node scripts/build.mjs` 会把 `upstream/` + `shell/` 合成到 `.build/`（gitignore），
再跑一次 `vite build` 输出到 `dist/`。上游快照永远不落地修改，升级上游只需
`node scripts/sync-upstream.mjs --ref <tag>` 后重跑构建测试。

`vendor/otools-plugin-sdk` 是宿主 SDK 的白名单快照（只有 `dist/` 与合规文件），
同样有内容哈希锁定：升级宿主 SDK 时先在 SDK 仓跑一次 `npm run build`（它的 `dist/`
不入库），再用 `npm run sync-sdk -- --from <宿主仓库的 vendor/otools-plugin-sdk>`
覆盖过来；CI 会跑 `npm run check-sdk` 拦就地修改。

## 宿主桥接约定

插件是纯 webview（`meta.json` 里 `nativeLibs: []`），所有能力都经 `shell/shim/host.ts`
的 `HostBackend` 走宿主。三条约定写在这里，避免重复踩坑：

1. **应用命令走 `__TAURI_INTERNALS__.invoke`，不要用 `window.otools.invokeNative()`。**
   后者是**原生 cdylib**（`.oplg` 里的 `lib/*.dylib`）的桥，纯 webview 插件调用必然
   被拒（`native disabled`）。`tools_webview_*` / `otools_*` 这类宿主命令只认
   `__TAURI_INTERNALS__.invoke`，页面被框架嵌套时宿主会把它同时挂到祖先窗口上。
2. **选择器走宿主 SDK 的页面内 DOM 树，不用 OS 原生对话框。**
   `shell/shim/hostTree.ts` 直接复用 `otools-plugin-sdk` 的 `pickFromHostTree`
   （数据只来自只读的 `tools_webview_browse_dialog`）。原生那条链（`dialog.open` /
   `tools_webview_pick_folder`）在 macOS 上会「闪一下就再也弹不出来」——原生 sheet 与
   宿主面板窗口的父子关系不稳定，第二次调用直接卡住，所以整条原生路径都**不要**碰。
   另存为额外用一行输入框问文件名（SDK 的树没有文件名输入），样式复用 SDK 已注入的
   `otools-host-tree-*` 类。
3. **失败必须可见**：`requestMenuAction` 用 `pickOrReport()` 包一层，选路径抛错时弹宿主
   消息框；同时通过 `hostLog()` 把 `[zitext] ...` 写进 `~/.otools/log/core/webview.log`，
   现场排查看这个文件即可（含后端类型、`window.otools` / `__TAURI_INTERNALS__` 是否存在）。

## 本地开发

```bash
npm install --legacy-peer-deps
npm run check-upstream            # 校验上游快照没被就地改过
npm run check-sdk                 # 校验 vendor 里的宿主 SDK 没被就地改过
npm test                            # 移植层 + 发布脚本单测
npm run typecheck                   # 上游源码 + 移植层 TS 检查
npm run build                       # 合成 .build/ + vite build → dist/
npm run dev                         # HMR，端口 5395
npm run preview                     # 静态预览 dist/，端口 5396（浏览器虚拟 FS）
npm run pack                        # 产出 dist-pack/*.oplg 并校验
```

浏览器预览模式没有宿主，文件读写走 localStorage 虚拟文件系统、路径用 `prompt` 输入；
要验证真实宿主行为，把 `.oplg` 装进 OTools（或在 `plugin.json` 开 `quickDev` 指向 devUrl）。

也可以在浏览器里注入 `__ZITEXT_HOST_BACKEND__` 实现一个 `HostBackend` 来做自动化冒烟测试。

## 发布

推送 `v<版本>` 标签触发 `.github/workflows/release-plugin.yml`：校验版本与标签、
上游快照校验、回归测试、TypeScript 检查、构建、六平台分包、独立校验、创建 GitHub Release。
需要同步插件市场时，在 workflow_dispatch 里带 `publish_market=true`（或配置仓库变量
`OTOOLS_PUBLISH_MARKET=true`，push tag 场景生效），并配置 `XYCLOUD_PAT` 等凭证。

### 六平台分包

`node scripts/pack-plugin.mjs --mode platform`（默认）按 6 个系统/架构出包，
`meta.json` 记 `packageMode=1`；市场 payload 相应上报 6 个 `packageUrl*` 字段，
宿主按当前平台优先下载平台包、失败回退合包：

| 后缀 | 平台 | 架构 | 市场字段 |
| --- | --- | --- | --- |
| `macos` | macOS | arm64 | `packageUrlMacos` |
| `macos-intel` | macOS | x64 | `packageUrlMacosIntel` |
| `windows` | Windows | x64 | `packageUrlWindows` |
| `windows-arm` | Windows | arm64 | `packageUrlWindowsArm` |
| `linux` | Linux | x64 | `packageUrlLinux` |
| `linux-arm` | Linux | arm64 | `packageUrlLinuxArm` |

本插件是纯 webview、没有 native cdylib，六个包内容完全相同（只有文件名不同），
所以发布目录会比单合包多占约 5 倍空间。需要单个合包时用
`node scripts/pack-plugin.mjs --mode combined`，对应 `packageMode=0`。

`publish-market.mjs` 的 `releaseMeta()` 强校验 `tag === "v" + plugin.json.version`，
改版本时 `plugin.json` 与 `package.json` 要一起改。

## 许可证

Apache-2.0，见 `LICENSE` / `NOTICE` / `THIRD_PARTY_NOTICES.md`。
字体许可见 `upstream/public/fonts/licenses/`。
