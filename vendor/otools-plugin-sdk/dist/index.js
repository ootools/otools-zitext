import { capture as xe } from "./capture.js";
import { AgentError as ve, createAgentApi as ke } from "./agent-factory.js";
import { createAiApi as Ce } from "./ai-factory.js";
import { createPluginDataApi as Oe } from "./plugin-data-factory.js";
import { ObservationError as Se, createObservationApi as Ne } from "./observation-factory.js";
import { createReminderApi as Le } from "./reminder-factory.js";
import { createOtoolsAliasMap as Ie } from "./aliases.js";
import { otoolsTauriShimPlugin as De } from "./vite.js";
import { listen as V, invoke as z, listenTauri as G, invokeTauri as J } from "./runtime.js";
import { emit as Fe, getOtoolsApi as Re, isOtoolsPluginRuntime as Be, openExternal as qe, openPath as $e } from "./runtime.js";
import { pickDirectory as We, pickFile as je, pickFiles as Ke, pickZipFile as Ve, saveFile as Ge } from "./dialog.js";
import { createDeepLinksApi as Ye } from "./deep-links.js";
import { CaptureError as Qe, createCaptureApi as Xe } from "./capture-factory.js";
function q() {
  if (!(typeof window > "u"))
    return window.otools ?? window.utools;
}
async function de(t, e) {
  const o = String(t ?? "").trim();
  if (!o)
    return;
  const r = q();
  if (r?.shellOpen) {
    await r.shellOpen(o, e);
    return;
  }
  if (r?.shellOpenExternal && /^https?:\/\//i.test(o)) {
    r.shellOpenExternal(o);
    return;
  }
  if (r?.shellOpenPath) {
    r.shellOpenPath(o);
    return;
  }
  typeof window < "u" && window.open(o, "_blank", "noopener,noreferrer");
}
async function ce(t) {
  const e = String(t ?? "").trim();
  if (!e)
    return;
  const o = q();
  if (o?.shellOpenPath) {
    o.shellOpenPath(e);
    return;
  }
}
async function ue(t) {
  const e = String(t ?? "").trim();
  if (!e)
    return;
  const o = q();
  if (o?.shellOpenExternal) {
    o.shellOpenExternal(e);
    return;
  }
  typeof window < "u" && window.open(e, "_blank", "noopener,noreferrer");
}
const Y = "otools-open-file", W = 3e3;
function Z(t) {
  if (!t)
    return [];
  try {
    const o = new URLSearchParams(t).get("otoolsOpenFile");
    if (!o)
      return [];
    const r = JSON.parse(o);
    return Array.isArray(r) ? r.map((a) => String(a || "").trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}
function Q(t) {
  return t.map((e) => {
    const o = String(e || "").trim(), r = o.split(/[\\/]/), a = r[r.length - 1] || o, d = a.lastIndexOf("."), p = d > 0 ? a.slice(d + 1).toLowerCase() : "";
    return { path: o, name: a, ext: p };
  });
}
function X() {
  if (typeof window < "u")
    try {
      const t = window.__OToolsEnv, e = typeof t?.pluginUuid == "string" ? t.pluginUuid.trim() : "";
      if (e)
        return e;
      const o = new URLSearchParams(window.location?.search || ""), r = (o.get("plugin") || o.get("pluginUuid") || o.get("plugin_uuid") || "").trim();
      if (r)
        return r;
    } catch {
    }
  return "";
}
async function pe(t) {
  const e = /* @__PURE__ */ new Map(), o = (p) => {
    const s = Date.now(), c = [];
    for (const u of p) {
      const h = String(u || "").trim();
      if (!h)
        continue;
      const g = e.get(h);
      typeof g == "number" && s - g < W || (e.set(h, s), c.push(h));
    }
    if (e.size > 256)
      for (const [u, h] of e)
        s - h >= W && e.delete(u);
    c.length && t(Q(c));
  }, r = async () => {
    const p = X();
    if (!p)
      return;
    let s = [];
    try {
      const c = await z("otools_consume_open_files", { pluginUuid: p });
      s = Array.isArray(c) ? c.map(String) : [];
    } catch {
      return;
    }
    o(s);
  }, a = await V(Y, () => {
    r();
  }), d = Z(
    typeof window < "u" && window.location?.search || ""
  );
  return d.length && o(d), r(), a;
}
const ee = "otools-keyword-dispatch";
function j() {
  if (typeof window < "u")
    try {
      const t = window.__OToolsEnv, e = typeof t?.pluginUuid == "string" ? t.pluginUuid.trim() : "";
      if (e)
        return e;
      const o = new URLSearchParams(window.location?.search || ""), r = (o.get("plugin") || o.get("pluginUuid") || o.get("plugin_uuid") || "").trim();
      if (r)
        return r;
    } catch {
    }
  return "";
}
const K = /* @__PURE__ */ new Map();
async function he(t) {
  const e = j(), o = typeof window > "u" ? void 0 : window.__TAURI_INTERNALS__?.metadata?.currentWebview?.label, r = JSON.stringify([e.toLowerCase(), o || ""]), a = K.get(r) || { entries: [], consuming: null };
  K.set(r, a);
  const d = a.consuming, p = /* @__PURE__ */ new Set();
  let s = !1, c = !1, u = null;
  const h = (m) => {
    const l = [];
    for (const k of m) {
      if (!k || typeof k != "object")
        continue;
      const y = k;
      typeof y.id != "string" || !y.id.trim() || typeof y.keyword != "string" || !y.keyword.trim() || p.has(y.id) || (p.add(y.id), l.push(y));
    }
    if (p.size > 512) {
      const k = Array.from(p).slice(-256);
      p.clear();
      for (const y of k)
        p.add(y);
    }
    l.length && !s && t(l);
  }, g = () => (c = !0, u || (u = (async () => {
    for (; c && !s; ) {
      if (c = !1, !e)
        return;
      if (!a.consuming) {
        const m = o ? { pluginUuid: e, targetLabel: o } : { pluginUuid: e };
        a.consuming = J("otools_consume_keyword_dispatch", m).then((l) => {
          Array.isArray(l) && a.entries.push(...l);
        }).finally(() => {
          a.consuming = null;
        });
      }
      try {
        await a.consuming;
      } catch {
        continue;
      }
      if (!s) {
        const m = a.entries;
        a.entries = [], h(m);
      }
    }
  })().finally(() => {
    u = null;
  }), u)), w = await G(ee, (m) => {
    const l = m?.payload;
    !s && (typeof l != "string" || l.toLowerCase() === j().toLowerCase()) && g();
  });
  return d ? d.catch(() => {
  }).then(() => {
    s || g();
  }) : g(), async () => {
    s = !0, c = !1, await w();
  };
}
async function te(t) {
  return z("tools_webview_browse_dialog", { request: { path: t ?? "" } });
}
async function fe(t) {
  const e = String(t ?? "").trim();
  if (!e)
    throw new Error("listHostDir requires path");
  return z("tools_webview_list_dir", { path: e });
}
async function me(t) {
  const e = String(t ?? "").trim();
  if (!e)
    throw new Error("readHostFile requires path");
  return z("tools_webview_read_file", { path: e });
}
const oe = (t, e) => {
  if (!e?.length || t.kind === "directory")
    return !0;
  const o = t.name.includes(".") ? t.name.split(".").pop().toLowerCase() : "";
  return e.some(
    (r) => r.extensions.some((a) => a.trim().toLowerCase().replace(/^\./, "") === o)
  );
};
function ne() {
  if (document.getElementById("otools-host-tree-style"))
    return;
  const t = document.createElement("style");
  t.id = "otools-host-tree-style", t.textContent = se, document.head.appendChild(t);
}
async function re(t) {
  if (typeof document > "u" || !document.body)
    throw new Error("pickFromHostTree requires a DOM document");
  const e = !!t.directory, o = !!t.multiple && !e, r = t.title ?? (e ? "选择目录" : "选择文件");
  let a = !!t.showHidden, d = null;
  return new Promise((p) => {
    let s = "", c = t.startPath ?? "", u = !1, h = !1, g = 0;
    const w = /* @__PURE__ */ new Set();
    ne();
    const m = document.createElement("div");
    m.setAttribute("data-host-tree", ""), m.className = "otools-host-tree-overlay";
    const l = document.createElement("div");
    l.className = "otools-host-tree-panel", l.setAttribute("role", "dialog"), l.setAttribute("aria-modal", "true"), l.setAttribute("aria-label", r), m.appendChild(l);
    const k = document.createElement("div");
    k.className = "otools-host-tree-header";
    const y = document.createElement("div");
    y.className = "otools-host-tree-title", y.textContent = r, k.appendChild(y);
    const I = document.createElement("div");
    I.className = "otools-host-tree-path", k.appendChild(I), l.appendChild(k);
    const C = document.createElement("div");
    C.className = "otools-host-tree-status", C.setAttribute("role", "status"), C.hidden = !0;
    const F = document.createElement("span");
    F.setAttribute("data-host-tree-error", "");
    const P = document.createElement("button");
    P.type = "button", P.className = "otools-host-tree-btn", P.textContent = "重试", P.setAttribute("data-host-tree-retry", ""), C.appendChild(F), C.appendChild(P), l.appendChild(C);
    const b = document.createElement("div");
    b.className = "otools-host-tree-body", l.appendChild(b);
    const S = document.createElement("div");
    S.className = "otools-host-tree-footer";
    const H = document.createElement("label");
    H.className = "otools-host-tree-toggle", H.title = "显示或隐藏以 . 开头的文件（如 .git、.env）";
    const N = document.createElement("input");
    N.type = "checkbox", N.checked = a, N.setAttribute("data-host-tree-show-hidden", ""), H.appendChild(N), H.appendChild(document.createTextNode("显示隐藏文件")), S.appendChild(H);
    const O = document.createElement("div");
    O.className = "otools-host-tree-selection", O.setAttribute("data-host-tree-selection", ""), O.setAttribute("role", "status"), O.textContent = e ? "请选择目录" : "请选择文件", S.appendChild(O);
    const T = document.createElement("button");
    T.type = "button", T.textContent = "取消", T.className = "otools-host-tree-btn", T.setAttribute("data-host-tree-cancel", "");
    const A = document.createElement("button");
    A.type = "button", A.textContent = e ? "选择此目录" : "选择", A.className = "otools-host-tree-btn otools-host-tree-btn-primary", A.setAttribute("data-host-tree-confirm", ""), A.disabled = !0, S.appendChild(T), S.appendChild(A), l.appendChild(S);
    const U = () => {
      A.disabled = !u || (e ? !s : !w.size), I.classList.toggle("otools-host-tree-current", e && u && !!s), O.textContent = e && u ? `已选目录：${s}` : w.size ? `已选 ${w.size} 个文件` : e ? "请选择目录" : "请选择文件", O.title = e && u ? s : "";
    }, D = (i) => {
      h || (h = !0, g += 1, window.removeEventListener("keydown", $, !0), m.remove(), p(i));
    }, $ = (i) => {
      i.key === "Escape" && (i.preventDefault(), i.stopImmediatePropagation(), D({ kind: "cancelled", source: "host-tree", paths: [], names: [] }));
    };
    window.addEventListener("keydown", $, !0), m.addEventListener("mousedown", (i) => {
      i.target === m && D({ kind: "cancelled", source: "host-tree", paths: [], names: [] });
    }), T.addEventListener(
      "click",
      () => D({ kind: "cancelled", source: "host-tree", paths: [], names: [] })
    ), A.addEventListener("click", () => {
      if (A.disabled) return;
      const i = e ? [s] : Array.from(w);
      D({
        kind: "picked",
        source: "host-tree",
        paths: i,
        names: i.map((x) => x.split(/[\\/]/).filter(Boolean).pop() || x)
      });
    });
    const M = (i) => {
      if (!i || typeof i.currentPath != "string" || !i.currentPath || !Array.isArray(i.roots) || !Array.isArray(i.entries))
        throw new Error("宿主返回的目录数据无效");
      if (s = i.currentPath, d = i, I.textContent = s, b.replaceChildren(), i.parentPath) {
        const n = document.createElement("div");
        n.className = "otools-host-tree-entry otools-host-tree-up", n.setAttribute("data-host-tree-up", ""), n.setAttribute("data-path", i.parentPath), n.setAttribute("data-kind", "directory"), n.textContent = "↑ 上一级", b.appendChild(n);
      }
      for (const n of i.roots) {
        const f = document.createElement("div");
        f.className = "otools-host-tree-entry otools-host-tree-root", f.setAttribute("data-host-tree-root", ""), f.setAttribute("data-path", n.path), f.setAttribute("data-kind", "directory"), f.textContent = `📁 ${n.name}  (${n.path})`, b.appendChild(f);
      }
      const x = (n) => n.name.startsWith("."), E = i.entries.filter(
        (n) => n.kind === "file" || n.kind === "directory"
      ), v = E.filter(x).length, _ = E.filter(
        (n) => (a || !x(n)) && oe(n, t.filters)
      );
      for (const n of _) {
        const f = document.createElement("div");
        f.className = "otools-host-tree-entry", f.setAttribute("data-host-tree-entry", ""), f.setAttribute("data-path", n.path), f.setAttribute("data-kind", n.kind);
        const B = document.createElement("span");
        if (B.className = "otools-host-tree-entry-label", B.textContent = n.kind === "directory" ? `📁 ${n.name}` : `📄 ${n.name}`, f.appendChild(B), !e && n.kind === "file") {
          f.setAttribute("aria-selected", "false");
          const L = document.createElement("span");
          L.className = "otools-host-tree-check", L.setAttribute("data-host-tree-check", ""), L.setAttribute("aria-hidden", "true"), L.textContent = "✓", L.hidden = !0, f.appendChild(L);
        }
        b.appendChild(f);
      }
      if (!_.length) {
        const n = document.createElement("div");
        n.className = "otools-host-tree-empty", n.textContent = v > 0 && !a ? `该目录只有 ${v} 个隐藏项，勾选「显示隐藏文件」查看` : "该目录为空", b.appendChild(n);
      }
    }, R = async (i) => {
      if (h) return;
      const x = ++g;
      c = i, u = !1, w.clear(), U(), C.hidden = !0, b.replaceChildren();
      const E = document.createElement("div");
      E.className = "otools-host-tree-empty", E.textContent = "正在读取目录…", b.appendChild(E);
      try {
        const v = await te(i);
        if (h || x !== g) return;
        M(v), u = !0, U();
      } catch (v) {
        if (h || x !== g) return;
        b.replaceChildren(), F.textContent = `无法读取宿主目录：${v instanceof Error ? v.message : String(v)}`, C.hidden = !1;
      }
    };
    P.addEventListener("click", () => {
      R(c);
    }), N.addEventListener("change", () => {
      a = N.checked, d && M(d), U();
    }), b.addEventListener("click", (i) => {
      if (!u || !(i.target instanceof Element)) return;
      const x = i.target.closest(
        "[data-host-tree-entry],[data-host-tree-root],[data-host-tree-up]"
      );
      if (!x || !b.contains(x)) return;
      const E = x.getAttribute("data-path") || "", v = x.getAttribute("data-kind");
      E && (v === "directory" ? R(E) : !e && v === "file" && (o ? w.has(E) ? w.delete(E) : w.add(E) : (w.clear(), w.add(E)), b.querySelectorAll("[data-host-tree-entry]").forEach((_) => {
        const n = w.has(_.getAttribute("data-path") || "");
        _.classList.toggle("otools-host-tree-selected", n), _.getAttribute("data-kind") === "file" && _.setAttribute("aria-selected", String(n));
        const f = _.querySelector("[data-host-tree-check]");
        f && (f.hidden = !n);
      }), U()));
    }), document.body.appendChild(m), R(c);
  });
}
typeof window < "u" && (window.__otoolsHostTree = re);
const se = `
.otools-host-tree-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2147483000;
  font-family: -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
}
.otools-host-tree-panel {
  width: min(560px, 90vw);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
  overflow: hidden;
  color: #1d1d1f;
}
.otools-host-tree-header {
  padding: 14px 18px 10px;
  border-bottom: 1px solid #ececec;
}
.otools-host-tree-title {
  font-size: 15px;
  font-weight: 600;
}
.otools-host-tree-path {
  margin-top: 4px;
  font-size: 12px;
  color: #6b6b70;
  word-break: break-all;
}
.otools-host-tree-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 16px;
  font-size: 13px;
  color: #b42318;
}
.otools-host-tree-status[hidden] { display: none; }
.otools-host-tree-body {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 6px 8px;
  min-height: 220px;
}
.otools-host-tree-entry {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 7px;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.otools-host-tree-entry:hover {
  background: #f2f2f4;
}
.otools-host-tree-up,
.otools-host-tree-root {
  color: #2b6fff;
}
.otools-host-tree-selected {
  background: #dbeafe !important;
  color: #174ea6 !important;
  box-shadow: inset 3px 0 #2563eb;
  font-weight: 600;
}
.otools-host-tree-entry-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.otools-host-tree-check { color: #174ea6; font-weight: 700; }
.otools-host-tree-check[hidden] { display: none; }
.otools-host-tree-current {
  background: #dbeafe;
  color: #174ea6;
  border-radius: 6px;
  padding: 6px 8px;
}
.otools-host-tree-selection {
  flex: 1;
  min-width: 0;
  color: #174ea6;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.otools-host-tree-empty {
  padding: 18px 10px;
  text-align: center;
  color: #9a9aa0;
  font-size: 13px;
}
.otools-host-tree-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 16px;
  border-top: 1px solid #ececec;
}
.otools-host-tree-toggle {
  margin-right: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #4a4a4f;
  cursor: pointer;
  user-select: none;
}
.otools-host-tree-toggle input {
  margin: 0;
  cursor: pointer;
}
.otools-host-tree-btn {
  padding: 7px 16px;
  border: 1px solid #d6d6da;
  border-radius: 8px;
  background: #f7f7f9;
  font-size: 13px;
  cursor: pointer;
}
.otools-host-tree-btn-primary {
  background: #2b6fff;
  border-color: #2b6fff;
  color: #fff;
}
.otools-host-tree-btn-primary:disabled {
  background: #b9c8ee;
  border-color: #b9c8ee;
  cursor: not-allowed;
}
`, ie = /^(?:transparent|#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgb|rgba|hsl|hsla)\([0-9 .,%/]{1,40}\))$/i, ae = (t) => typeof t == "string" && t.length <= 48 && ie.test(t), we = (t) => {
  let e = 0, o, r = !1;
  const a = (d, p) => {
    if (typeof window > "u" || !window.parent || window.parent === window) return Promise.reject(new Error("Host theme API unavailable"));
    const s = window.parent, c = `host-theme-${Date.now()}-${++e}`;
    return new Promise((u, h) => {
      const g = () => {
        window.removeEventListener("message", w), clearTimeout(m);
      }, w = (l) => {
        l.source !== s || l.data?.type !== "otools:host-theme-result" || l.data.id !== c || (g(), l.data.ok === !0 ? u() : h(new Error(String(l.data.error || "Host theme request rejected"))));
      }, m = setTimeout(() => {
        g(), h(new Error("Host theme request timed out"));
      }, 3e3);
      window.addEventListener("message", w);
      try {
        s.postMessage({ type: "otools:host-theme", id: c, theme: d, background: p }, "*");
      } catch (l) {
        g(), h(l);
      }
    });
  };
  return async (d, p) => {
    if (d !== "light" && d !== "dark" && d !== null) throw new Error("Invalid host theme");
    const s = p?.background ?? null;
    if (s !== null) {
      if (d === null) throw new Error("Host theme background requires a theme");
      if (!ae(s)) throw new Error("Invalid host theme background");
    }
    const c = s;
    if (t.isNative?.() === !1)
      return o = { theme: d, background: c }, !r && typeof window < "u" && (r = !0, window.addEventListener("message", (u) => {
        u.source === window.parent && u.data?.type === "otools:host-theme-ready" && o !== void 0 && a(o.theme, o.background).catch(() => {
        });
      })), a(d, c);
    await t.invoke("otools_host_set_theme_override", { theme: d, background: c });
  };
}, ge = () => () => {
  if (typeof window > "u") return "window";
  const t = (e) => e === "panel" || e === "tabs" || e === "window";
  try {
    const e = window.__OToolsEnv?.pageMode;
    if (t(e)) return e;
  } catch {
  }
  try {
    if (window.__OTOOLS_CUSTOM_WINDOW__ || window.document?.documentElement?.hasAttribute("data-otools-custom")) return "window";
    if (window.document?.documentElement?.hasAttribute("data-otools-panel")) return "panel";
  } catch {
  }
  try {
    const e = window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label;
    if (e === "otools-panel") return "panel";
    if (e === "main") return "tabs";
    if (e) return "window";
  } catch {
  }
  try {
    const e = window.frameElement?.getAttribute("data-otools-page-mode");
    if (t(e)) return e;
  } catch {
  }
  return "window";
};
export {
  ve as AgentError,
  Qe as CaptureError,
  Y as OTOOLS_FILE_DELIVER_EVENT,
  ee as OTOOLS_KEYWORD_DISPATCH_EVENT,
  Se as ObservationError,
  te as browseHostDir,
  xe as capture,
  ke as createAgentApi,
  Ce as createAiApi,
  Xe as createCaptureApi,
  Ye as createDeepLinksApi,
  Ne as createObservationApi,
  Ie as createOtoolsAliasMap,
  ge as createPageModeGetter,
  Oe as createPluginDataApi,
  Le as createReminderApi,
  we as createTempHostThemeSetter,
  Fe as emit,
  Re as getOtoolsApi,
  z as invoke,
  Be as isOtoolsPluginRuntime,
  ae as isValidHostThemeBackground,
  fe as listHostDir,
  V as listen,
  he as onOtoolsKeyword,
  pe as onOtoolsOpenFile,
  qe as openExternal,
  $e as openPath,
  De as otoolsTauriShimPlugin,
  Z as parseLaunchOpenFiles,
  We as pickDirectory,
  je as pickFile,
  Ke as pickFiles,
  re as pickFromHostTree,
  Ve as pickZipFile,
  me as readHostFile,
  Ge as saveFile,
  de as shellOpen,
  ue as shellOpenExternal,
  ce as shellOpenPath,
  Q as toOpenFileEntries
};
//# sourceMappingURL=index.js.map
