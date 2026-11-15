import { capture as he } from "./capture.js";
import { AgentError as we, createAgentApi as ge } from "./agent-factory.js";
import { createAiApi as be } from "./ai-factory.js";
import { createPluginDataApi as Ee } from "./plugin-data-factory.js";
import { ObservationError as ke, createObservationApi as Ae } from "./observation-factory.js";
import { createReminderApi as Ce } from "./reminder-factory.js";
import { createOtoolsAliasMap as Pe } from "./aliases.js";
import { otoolsTauriShimPlugin as Le } from "./vite.js";
import { listen as B, invoke as L, listenTauri as M, invokeTauri as $ } from "./runtime.js";
import { emit as Te, getOtoolsApi as Ie, isOtoolsPluginRuntime as Ue, openExternal as De, openPath as He } from "./runtime.js";
import { pickDirectory as Re, pickFile as ze, pickFiles as qe, pickZipFile as Be, saveFile as Me } from "./dialog.js";
import { createDeepLinksApi as We } from "./deep-links.js";
import { CaptureError as Ke, createCaptureApi as Ve } from "./capture-factory.js";
function U() {
  if (!(typeof window > "u"))
    return window.otools ?? window.utools;
}
async function ne(t, e) {
  const o = String(t ?? "").trim();
  if (!o)
    return;
  const r = U();
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
async function re(t) {
  const e = String(t ?? "").trim();
  if (!e)
    return;
  const o = U();
  if (o?.shellOpenPath) {
    o.shellOpenPath(e);
    return;
  }
}
async function se(t) {
  const e = String(t ?? "").trim();
  if (!e)
    return;
  const o = U();
  if (o?.shellOpenExternal) {
    o.shellOpenExternal(e);
    return;
  }
  typeof window < "u" && window.open(e, "_blank", "noopener,noreferrer");
}
const W = "otools-open-file", F = 3e3;
function j(t) {
  if (!t)
    return [];
  try {
    const o = new URLSearchParams(t).get("otoolsOpenFile");
    if (!o)
      return [];
    const r = JSON.parse(o);
    return Array.isArray(r) ? r.map((l) => String(l || "").trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}
function K(t) {
  return t.map((e) => {
    const o = String(e || "").trim(), r = o.split(/[\\/]/), l = r[r.length - 1] || o, a = l.lastIndexOf("."), p = a > 0 ? l.slice(a + 1).toLowerCase() : "";
    return { path: o, name: l, ext: p };
  });
}
function V() {
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
async function ie(t) {
  const e = /* @__PURE__ */ new Map(), o = (p) => {
    const s = Date.now(), d = [];
    for (const h of p) {
      const c = String(h || "").trim();
      if (!c)
        continue;
      const m = e.get(c);
      typeof m == "number" && s - m < F || (e.set(c, s), d.push(c));
    }
    if (e.size > 256)
      for (const [h, c] of e)
        s - c >= F && e.delete(h);
    d.length && t(K(d));
  }, r = async () => {
    const p = V();
    if (!p)
      return;
    let s = [];
    try {
      const d = await L("otools_consume_open_files", { pluginUuid: p });
      s = Array.isArray(d) ? d.map(String) : [];
    } catch {
      return;
    }
    o(s);
  }, l = await B(W, () => {
    r();
  }), a = j(
    typeof window < "u" && window.location?.search || ""
  );
  return a.length && o(a), r(), l;
}
const G = "otools-keyword-dispatch";
function R() {
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
const z = /* @__PURE__ */ new Map();
async function ae(t) {
  const e = R(), o = typeof window > "u" ? void 0 : window.__TAURI_INTERNALS__?.metadata?.currentWebview?.label, r = JSON.stringify([e.toLowerCase(), o || ""]), l = z.get(r) || { entries: [], consuming: null };
  z.set(r, l);
  const a = l.consuming, p = /* @__PURE__ */ new Set();
  let s = !1, d = !1, h = null;
  const c = (y) => {
    const f = [];
    for (const E of y) {
      if (!E || typeof E != "object")
        continue;
      const w = E;
      typeof w.id != "string" || !w.id.trim() || typeof w.keyword != "string" || !w.keyword.trim() || p.has(w.id) || (p.add(w.id), f.push(w));
    }
    if (p.size > 512) {
      const E = Array.from(p).slice(-256);
      p.clear();
      for (const w of E)
        p.add(w);
    }
    f.length && !s && t(f);
  }, m = () => (d = !0, h || (h = (async () => {
    for (; d && !s; ) {
      if (d = !1, !e)
        return;
      if (!l.consuming) {
        const y = o ? { pluginUuid: e, targetLabel: o } : { pluginUuid: e };
        l.consuming = $("otools_consume_keyword_dispatch", y).then((f) => {
          Array.isArray(f) && l.entries.push(...f);
        }).finally(() => {
          l.consuming = null;
        });
      }
      try {
        await l.consuming;
      } catch {
        continue;
      }
      if (!s) {
        const y = l.entries;
        l.entries = [], c(y);
      }
    }
  })().finally(() => {
    h = null;
  }), h)), g = await M(G, (y) => {
    const f = y?.payload;
    !s && (typeof f != "string" || f.toLowerCase() === R().toLowerCase()) && m();
  });
  return a ? a.catch(() => {
  }).then(() => {
    s || m();
  }) : m(), async () => {
    s = !0, d = !1, await g();
  };
}
async function J(t) {
  return L("tools_webview_browse_dialog", { request: { path: t ?? "" } });
}
async function le(t) {
  const e = String(t ?? "").trim();
  if (!e)
    throw new Error("listHostDir requires path");
  return L("tools_webview_list_dir", { path: e });
}
async function de(t) {
  const e = String(t ?? "").trim();
  if (!e)
    throw new Error("readHostFile requires path");
  return L("tools_webview_read_file", { path: e });
}
const Y = (t, e) => {
  if (!e?.length || t.kind === "directory")
    return !0;
  const o = t.name.includes(".") ? t.name.split(".").pop().toLowerCase() : "";
  return e.some(
    (r) => r.extensions.some((l) => l.trim().toLowerCase().replace(/^\./, "") === o)
  );
};
function Z() {
  if (document.getElementById("otools-host-tree-style"))
    return;
  const t = document.createElement("style");
  t.id = "otools-host-tree-style", t.textContent = X, document.head.appendChild(t);
}
async function Q(t) {
  if (typeof document > "u" || !document.body)
    throw new Error("pickFromHostTree requires a DOM document");
  const e = !!t.directory, o = !!t.multiple && !e, r = t.title ?? (e ? "选择目录" : "选择文件");
  return new Promise((l) => {
    let a = "", p = t.startPath ?? "", s = !1, d = !1, h = 0;
    const c = /* @__PURE__ */ new Set();
    Z();
    const m = document.createElement("div");
    m.setAttribute("data-host-tree", ""), m.className = "otools-host-tree-overlay";
    const g = document.createElement("div");
    g.className = "otools-host-tree-panel", g.setAttribute("role", "dialog"), g.setAttribute("aria-modal", "true"), g.setAttribute("aria-label", r), m.appendChild(g);
    const y = document.createElement("div");
    y.className = "otools-host-tree-header";
    const f = document.createElement("div");
    f.className = "otools-host-tree-title", f.textContent = r, y.appendChild(f);
    const E = document.createElement("div");
    E.className = "otools-host-tree-path", y.appendChild(E), g.appendChild(y);
    const w = document.createElement("div");
    w.className = "otools-host-tree-status", w.setAttribute("role", "status"), w.hidden = !0;
    const N = document.createElement("span");
    N.setAttribute("data-host-tree-error", "");
    const C = document.createElement("button");
    C.type = "button", C.className = "otools-host-tree-btn", C.textContent = "重试", C.setAttribute("data-host-tree-retry", ""), w.appendChild(N), w.appendChild(C), g.appendChild(w);
    const b = document.createElement("div");
    b.className = "otools-host-tree-body", g.appendChild(b);
    const P = document.createElement("div");
    P.className = "otools-host-tree-footer";
    const _ = document.createElement("div");
    _.className = "otools-host-tree-selection", _.setAttribute("data-host-tree-selection", ""), _.setAttribute("role", "status"), _.textContent = e ? "请选择目录" : "请选择文件", P.appendChild(_);
    const O = document.createElement("button");
    O.type = "button", O.textContent = "取消", O.className = "otools-host-tree-btn", O.setAttribute("data-host-tree-cancel", "");
    const k = document.createElement("button");
    k.type = "button", k.textContent = e ? "选择此目录" : "选择", k.className = "otools-host-tree-btn otools-host-tree-btn-primary", k.setAttribute("data-host-tree-confirm", ""), k.disabled = !0, P.appendChild(O), P.appendChild(k), g.appendChild(P);
    const T = () => {
      k.disabled = !s || (e ? !a : !c.size), E.classList.toggle("otools-host-tree-current", e && s && !!a), _.textContent = e && s ? `已选目录：${a}` : c.size ? `已选 ${c.size} 个文件` : e ? "请选择目录" : "请选择文件", _.title = e && s ? a : "";
    }, S = (i) => {
      d || (d = !0, h += 1, window.removeEventListener("keydown", D, !0), m.remove(), l(i));
    }, D = (i) => {
      i.key === "Escape" && (i.preventDefault(), i.stopImmediatePropagation(), S({ kind: "cancelled", source: "host-tree", paths: [], names: [] }));
    };
    window.addEventListener("keydown", D, !0), m.addEventListener("mousedown", (i) => {
      i.target === m && S({ kind: "cancelled", source: "host-tree", paths: [], names: [] });
    }), O.addEventListener(
      "click",
      () => S({ kind: "cancelled", source: "host-tree", paths: [], names: [] })
    ), k.addEventListener("click", () => {
      if (k.disabled) return;
      const i = e ? [a] : Array.from(c);
      S({
        kind: "picked",
        source: "host-tree",
        paths: i,
        names: i.map((x) => x.split(/[\\/]/).filter(Boolean).pop() || x)
      });
    });
    const q = (i) => {
      if (!i || typeof i.currentPath != "string" || !i.currentPath || !Array.isArray(i.roots) || !Array.isArray(i.entries))
        throw new Error("宿主返回的目录数据无效");
      if (a = i.currentPath, E.textContent = a, b.replaceChildren(), i.parentPath) {
        const n = document.createElement("div");
        n.className = "otools-host-tree-entry otools-host-tree-up", n.setAttribute("data-host-tree-up", ""), n.setAttribute("data-path", i.parentPath), n.setAttribute("data-kind", "directory"), n.textContent = "↑ 上一级", b.appendChild(n);
      }
      for (const n of i.roots) {
        const u = document.createElement("div");
        u.className = "otools-host-tree-entry otools-host-tree-root", u.setAttribute("data-host-tree-root", ""), u.setAttribute("data-path", n.path), u.setAttribute("data-kind", "directory"), u.textContent = `📁 ${n.name}  (${n.path})`, b.appendChild(u);
      }
      const x = i.entries.filter(
        (n) => (n.kind === "file" || n.kind === "directory") && Y(n, t.filters)
      );
      for (const n of x) {
        const u = document.createElement("div");
        u.className = "otools-host-tree-entry", u.setAttribute("data-host-tree-entry", ""), u.setAttribute("data-path", n.path), u.setAttribute("data-kind", n.kind);
        const A = document.createElement("span");
        if (A.className = "otools-host-tree-entry-label", A.textContent = n.kind === "directory" ? `📁 ${n.name}` : `📄 ${n.name}`, u.appendChild(A), !e && n.kind === "file") {
          u.setAttribute("aria-selected", "false");
          const v = document.createElement("span");
          v.className = "otools-host-tree-check", v.setAttribute("data-host-tree-check", ""), v.setAttribute("aria-hidden", "true"), v.textContent = "✓", v.hidden = !0, u.appendChild(v);
        }
        b.appendChild(u);
      }
      if (!x.length) {
        const n = document.createElement("div");
        n.className = "otools-host-tree-empty", n.textContent = "该目录为空", b.appendChild(n);
      }
    }, I = async (i) => {
      if (d) return;
      const x = ++h;
      p = i, s = !1, c.clear(), T(), w.hidden = !0, b.replaceChildren();
      const n = document.createElement("div");
      n.className = "otools-host-tree-empty", n.textContent = "正在读取目录…", b.appendChild(n);
      try {
        const u = await J(i);
        if (d || x !== h) return;
        q(u), s = !0, T();
      } catch (u) {
        if (d || x !== h) return;
        b.replaceChildren(), N.textContent = `无法读取宿主目录：${u instanceof Error ? u.message : String(u)}`, w.hidden = !1;
      }
    };
    C.addEventListener("click", () => {
      I(p);
    }), b.addEventListener("click", (i) => {
      if (!s || !(i.target instanceof Element)) return;
      const x = i.target.closest(
        "[data-host-tree-entry],[data-host-tree-root],[data-host-tree-up]"
      );
      if (!x || !b.contains(x)) return;
      const n = x.getAttribute("data-path") || "", u = x.getAttribute("data-kind");
      n && (u === "directory" ? I(n) : !e && u === "file" && (o ? c.has(n) ? c.delete(n) : c.add(n) : (c.clear(), c.add(n)), b.querySelectorAll("[data-host-tree-entry]").forEach((A) => {
        const v = c.has(A.getAttribute("data-path") || "");
        A.classList.toggle("otools-host-tree-selected", v), A.getAttribute("data-kind") === "file" && A.setAttribute("aria-selected", String(v));
        const H = A.querySelector("[data-host-tree-check]");
        H && (H.hidden = !v);
      }), T()));
    }), document.body.appendChild(m), I(p);
  });
}
typeof window < "u" && (window.__otoolsHostTree = Q);
const X = `
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
`, ee = /^(?:transparent|#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgb|rgba|hsl|hsla)\([0-9 .,%/]{1,40}\))$/i, te = (t) => typeof t == "string" && t.length <= 48 && ee.test(t), ce = (t) => {
  let e = 0, o, r = !1;
  const l = (a, p) => {
    if (typeof window > "u" || !window.parent || window.parent === window) return Promise.reject(new Error("Host theme API unavailable"));
    const s = window.parent, d = `host-theme-${Date.now()}-${++e}`;
    return new Promise((h, c) => {
      const m = () => {
        window.removeEventListener("message", g), clearTimeout(y);
      }, g = (f) => {
        f.source !== s || f.data?.type !== "otools:host-theme-result" || f.data.id !== d || (m(), f.data.ok === !0 ? h() : c(new Error(String(f.data.error || "Host theme request rejected"))));
      }, y = setTimeout(() => {
        m(), c(new Error("Host theme request timed out"));
      }, 3e3);
      window.addEventListener("message", g);
      try {
        s.postMessage({ type: "otools:host-theme", id: d, theme: a, background: p }, "*");
      } catch (f) {
        m(), c(f);
      }
    });
  };
  return async (a, p) => {
    if (a !== "light" && a !== "dark" && a !== null) throw new Error("Invalid host theme");
    const s = p?.background ?? null;
    if (s !== null) {
      if (a === null) throw new Error("Host theme background requires a theme");
      if (!te(s)) throw new Error("Invalid host theme background");
    }
    const d = s;
    if (t.isNative?.() === !1)
      return o = { theme: a, background: d }, !r && typeof window < "u" && (r = !0, window.addEventListener("message", (h) => {
        h.source === window.parent && h.data?.type === "otools:host-theme-ready" && o !== void 0 && l(o.theme, o.background).catch(() => {
        });
      })), l(a, d);
    await t.invoke("otools_host_set_theme_override", { theme: a, background: d });
  };
}, ue = () => () => {
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
  we as AgentError,
  Ke as CaptureError,
  W as OTOOLS_FILE_DELIVER_EVENT,
  G as OTOOLS_KEYWORD_DISPATCH_EVENT,
  ke as ObservationError,
  J as browseHostDir,
  he as capture,
  ge as createAgentApi,
  be as createAiApi,
  Ve as createCaptureApi,
  We as createDeepLinksApi,
  Ae as createObservationApi,
  Pe as createOtoolsAliasMap,
  ue as createPageModeGetter,
  Ee as createPluginDataApi,
  Ce as createReminderApi,
  ce as createTempHostThemeSetter,
  Te as emit,
  Ie as getOtoolsApi,
  L as invoke,
  Ue as isOtoolsPluginRuntime,
  te as isValidHostThemeBackground,
  le as listHostDir,
  B as listen,
  ae as onOtoolsKeyword,
  ie as onOtoolsOpenFile,
  De as openExternal,
  He as openPath,
  Le as otoolsTauriShimPlugin,
  j as parseLaunchOpenFiles,
  Re as pickDirectory,
  ze as pickFile,
  qe as pickFiles,
  Q as pickFromHostTree,
  Be as pickZipFile,
  de as readHostFile,
  Me as saveFile,
  ne as shellOpen,
  se as shellOpenExternal,
  re as shellOpenPath,
  K as toOpenFileEntries
};
//# sourceMappingURL=index.js.map
