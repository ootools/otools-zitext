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
| 打开、打开文件夹、另存为对话框 | `window.otools.dialog`，返回本机真实路径 |
| 确认/提示对话框、剪贴板、外链 | 宿主 dialog、Clipboard API、`shellOpenExternal` |
| settings.json / session.json / scratchpad / recent files | 插件自己的 IndexedDB（localStorage 兜底） |
| 大文件日志查看器 | 宿主一次读入后在 webview 内建行索引、过滤、搜索、导出（≤256 MB） |
| 原生菜单、窗口标题/全屏、CLI 启动参数 | 宿主接管；`otools_consume_open_files` 对接「打开方式」 |
| 在线更新检查 | 关闭，由 OTools 插件市场统一发布 |

## 目录结构

```
upstream/            上游前端原样快照（不要就地改，upstream.lock.json 有内容哈希）
shell/
  shim/              @tauri-apps/* 的替身：core/event/window/app/dialog/clipboard
    backend/         fs.ts / state.ts / largeFile.ts：Rust 命令的 webview 实现
    host.ts          OTools 宿主 / 浏览器虚拟 FS 的统一后端抽象
  src/               必须覆盖的上游文件（目前仅关闭在线更新检查）
  tests/             移植层回归测试
  index.html         插件入口（相对路径资源 + OTools 标记）
  vite.config.ts     alias + base:'./'（宿主用 otools-plugin:// 加载）
scripts/             合成构建树、构建、测试、打包、校验、发布、上游同步
.github/workflows/    release-plugin.yml（tag v* 触发）
dist/                构建产物（提交进仓库，方便子模块直接安装）
```

`node scripts/build.mjs` 会把 `upstream/` + `shell/` 合成到 `.build/`（gitignore），
再跑一次 `vite build` 输出到 `dist/`。上游快照永远不落地修改，升级上游只需
`node scripts/sync-upstream.mjs --ref <tag>` 后重跑构建测试。

## 本地开发

```bash
npm install --legacy-peer-deps
node scripts/check-upstream.mjs     # 校验上游快照没被就地改过
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
回归测试、上游快照校验、构建、打 `.oplg`、独立校验、创建 GitHub Release。
需要同步插件市场时，在 workflow_dispatch 里带 `publish_market=true`（或配置仓库变量
`OTOOLS_PUBLISH_MARKET=true`，push tag 场景生效），并配置 `XYCLOUD_PAT` 等凭证。

`publish-market.mjs` 的 `releaseMeta()` 强校验 `tag === "v" + plugin.json.version`，
改版本时 `plugin.json` 与 `package.json` 要一起改。

## 许可证

Apache-2.0，见 `LICENSE` / `NOTICE` / `THIRD_PARTY_NOTICES.md`。
字体许可见 `upstream/public/fonts/licenses/`。
