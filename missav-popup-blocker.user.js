// ==UserScript==
// @name         MissAV ad & popup blocker
// @namespace    local.missav-popup-blocker
// @version      1.0.0
// @description  Block MissAV ad frames, popunders and partner links while keeping the player working.
// @match        *://missav.ws/*
// @match        *://*.missav.ws/*
// @match        *://missav.com/*
// @match        *://*.missav.com/*
// @match        *://missav.ai/*
// @match        *://*.missav.ai/*
// @match        *://missav.live/*
// @match        *://*.missav.live/*
// @match        *://123av.org/*
// @match        *://*.123av.org/*
// @match        *://njavtv.com/*
// @match        *://*.njavtv.com/*
// @match        *://thisav2.com/*
// @match        *://*.thisav2.com/*
// @match        *://kizzew.com/*
// @match        *://*.kizzew.com/*
// @match        *://myav.com/*
// @match        *://*.myav.com/*
// Rotating ad networks are gated at runtime by missavContext()/adFrameContext().
// @match        *://*/*
// @include      about:blank
// @run-at       document-start
// @grant        GM_setClipboard
// @grant        unsafeWindow
// Tampermonkey-only: cancel ad network requests before they leave the browser,
// which also kills parser-created ad <script>/<iframe> nodes. Ignored by other
// userscript managers (the runtime DOM/popup guards still apply there).
// @webRequest   [{"selector":{"include":["*://*.mavrtracktor.com/*","*://*.myavlive.com/*","*://*.doppiocdn.com/*","*://*.mayzaent.com/*","*://*.snaptrckr.fun/*","*://*.rallytrck.website/*","*://*.tsyndicate.com/*","*://*.magsrv.com/*","*://*.exoclick.com/*","*://*.exosrv.com/*","*://*.realsrv.com/*","*://*.juicyads.com/*","*://*.trafficjunky.net/*","*://*.partwithner.com/*"],"types":["script","sub_frame","image","xmlhttprequest","ping","other"]},"action":"cancel"}]
// ==/UserScript==

(() => {
  "use strict";

  // MissAV keeps moving between mirror domains. Only these hosts are treated
  // as "the site", everything else is either a player/file host or an ad.
  const mirrorDomains = [
    "missav.ws",
    "missav.com",
    "missav.ai",
    "missav.live",
    "missav123.com",
    "missav789.com",
    "missav888.com",
    "missav01.com",
    "123av.org",
    "njavtv.com",
    "thisav2.com",
    "kizzew.com",
    "m.this.av",
    "myav.com"
  ];

  // Ad / popunder / affiliate networks observed on MissAV plus the usual
  // rotating suspects. Blocking the host also removes its iframes, scripts
  // and partner links.
  const adDomains = [
    // mavrtracktor / Stripchat widgets
    "mavrtracktor.com",
    "myavlive.com",
    "doppiocdn.com",
    "stripcash.com",
    "stripchat.com",
    // go.mayzaent.com smartpop (popunder)
    "mayzaent.com",
    // tracking banners
    "snaptrckr.fun",
    "rallytrck.website",
    // TrafficStars / ExoClick style in-page + video ads
    "tsyndicate.com",
    "magsrv.com",
    "exoclick.com",
    "exosrv.com",
    "realsrv.com",
    "juicyads.com",
    "trafficjunky.net",
    // generic popunder networks
    "popads.net",
    "propellerads.com",
    "hilltopads.net",
    "adsterra.com",
    "clickadu.com",
    "onclickads.net",
    // partner image banners (bit.ly links out of the nav menu)
    "partwithner.com",
    "bit.ly",
    // google ad stacks
    "googlesyndication.com",
    "doubleclick.net"
  ];

  // MissAV's own popunder endpoint: window.open("/pop?url=<ad>", "_blank").
  const popUnderPath = /^\/pop(?:$|[/?])/i;

  const exportPanelId = "missav-export-panel";
  const exportButtonId = "missav-export-link";

  const hostMatches = (host, domain) => host === domain || host.endsWith("." + domain);

  const bareHost = (value) => String(value || "").replace(/^www\./, "");

  const hostOf = (url) => {
    try {
      return bareHost(new URL(url, location.href).hostname);
    } catch {
      return "";
    }
  };

  const topLevel = () => {
    try {
      return window.top === window.self;
    } catch {
      return false;
    }
  };

  const frameContext = () => {
    try {
      if (window.top !== window.self) return true;
    } catch {
      return true;
    }
    return /^about:blank(?:[#?].*)?$/i.test(location.href);
  };

  const isMirrorHost = (host) => mirrorDomains.some((domain) => hostMatches(host, domain));

  const isAdHost = (host) => adDomains.some((domain) => hostMatches(host, domain));

  // Ad iframes / scripts / links all share one predicate.
  const isAdUrl = (url) => {
    const text = String(url == null ? "" : url).trim();
    if (!text) return false;
    if (/^(?:blob:|data:|filesystem:)/i.test(text)) return false;

    let parsed;
    try {
      parsed = new URL(text, location.href);
    } catch {
      return false;
    }

    if (isAdHost(bareHost(parsed.hostname))) return true;
    if (popUnderPath.test(parsed.pathname)) return true;
    return false;
  };

  // True on the actual MissAV pages (top level or a player/file frame it made).
  const missavContext = () =>
    isMirrorHost(bareHost(location.hostname)) ||
    (frameContext() && !!document.referrer && isMirrorHost(hostOf(document.referrer)));

  // True while running inside an ad frame, so the frame cannot pop anything.
  const adFrameContext = () => isAdHost(bareHost(location.hostname));

  const fakeWindow = () => ({
    __missavBlocked: true,
    closed: false,
    close() {
      this.closed = true;
    },
    focus() {},
    blur() {},
    postMessage() {},
    location: {
      href: "about:blank",
      assign() {},
      replace() {}
    },
    document: {
      write() {},
      close() {},
      open() {
        return this;
      }
    }
  });

  const popupTarget = (target) => !target || !/^_(?:self|top|parent)$/i.test(String(target));
  const blankAction = (url) => !url || /^about:blank(?:[#?].*)?$/i.test(String(url).trim());

  // Popup policy: block the site's /pop?url= redirector, ad hosts and blank
  // popunders. Real "download" popups (rapidgator, keepshare, magnets, share
  // links) are left untouched.
  const blockedPopup = (url, target) => {
    if (adFrameContext()) return true;
    if (!popupTarget(target)) return false;
    const text = String(url == null ? "" : url).trim();
    if (!text || blankAction(text)) return true;
    if (/^(?:javascript:|#)/i.test(text)) return true;
    return isAdUrl(text);
  };

  const blockedNavigation = (url) => {
    const text = String(url == null ? "" : url).trim();
    if (!text) return false;
    if (/^(?:javascript:|#|about:blank(?:[#?].*)?$)/i.test(text)) return false;
    return isAdUrl(text);
  };

  const installPopupGuard = () => {
    const pageWindow = typeof unsafeWindow === "object" && unsafeWindow ? unsafeWindow : window;

    const wrapOpen = (nativeOpen) => {
      if (!nativeOpen || nativeOpen.__missavWrappedOpen) return nativeOpen;
      const wrapped = function (url, target, ...args) {
        if (blockedPopup(url, target)) return fakeWindow();
        return nativeOpen.call(this, url, target, ...args);
      };
      wrapped.__missavWrappedOpen = true;
      return wrapped;
    };

    const patchOpen = (target) => {
      try {
        const wrapped = wrapOpen(target.open);
        if (!wrapped || wrapped === target.open) return;
        Object.defineProperty(target, "open", {
          configurable: false,
          writable: false,
          value: wrapped
        });
      } catch {
        // Cross-world / cross-origin objects may reject replacement.
      }
    };

    patchOpen(pageWindow);
    if (pageWindow.Window && pageWindow.Window.prototype) patchOpen(pageWindow.Window.prototype);

    try {
      const nativeAssign = Location.prototype.assign;
      const nativeReplace = Location.prototype.replace;
      Location.prototype.assign = function (url) {
        if (blockedNavigation(url)) return;
        return nativeAssign.call(this, url);
      };
      Location.prototype.replace = function (url) {
        if (blockedNavigation(url)) return;
        return nativeReplace.call(this, url);
      };
    } catch {
      // Some frames lock Location.
    }
  };

  const blockedElement = (node) => {
    if (!node || node.nodeType !== 1) return false;
    if (!/^(?:SCRIPT|IFRAME)$/i.test(node.tagName)) return false;
    const src = node.getAttribute("src") || node.src || "";
    return !!src && isAdUrl(src);
  };

  // Stop dynamically created ad <script>/<iframe> nodes before they run.
  const installResourceGuard = () => {
    try {
      const nativeSetAttribute = Element.prototype.setAttribute;
      Element.prototype.setAttribute = function (name, value) {
        if (/^src$/i.test(name) && /^(?:SCRIPT|IFRAME)$/i.test(this.tagName) && isAdUrl(value)) return;
        return nativeSetAttribute.call(this, name, value);
      };
    } catch {
      // best effort
    }

    for (const prototype of [HTMLScriptElement.prototype, HTMLIFrameElement.prototype]) {
      try {
        const descriptor = Object.getOwnPropertyDescriptor(prototype, "src");
        if (!descriptor || !descriptor.set || descriptor.set.__missavWrappedSrc) continue;
        const wrappedSet = function (value) {
          if (isAdUrl(value)) return;
          return descriptor.set.call(this, value);
        };
        wrappedSet.__missavWrappedSrc = true;
        Object.defineProperty(prototype, "src", {
          ...descriptor,
          set: wrappedSet
        });
      } catch {
        // best effort
      }
    }

    try {
      const nativeAppendChild = Node.prototype.appendChild;
      const nativeInsertBefore = Node.prototype.insertBefore;
      Node.prototype.appendChild = function (node) {
        if (blockedElement(node)) return node;
        return nativeAppendChild.call(this, node);
      };
      Node.prototype.insertBefore = function (node, child) {
        if (blockedElement(node)) return node;
        return nativeInsertBefore.call(this, node, child);
      };
    } catch {
      // best effort
    }
  };

  const adSlotWrappers = (el) => {
    const classes = el.classList;
    if (!classes) return false;
    if (classes.contains("mx-auto")) return true;
    if (classes.contains("under_player")) return true;
    if (classes.contains("space-y-6") && classes.contains("mb-6")) return true;
    if (classes.contains("space-y-5") && classes.contains("mb-5")) return true;
    if (classes.contains("hidden") && classes.contains("lg:block")) return true;
    if (classes.contains("relative") && classes.contains("overflow-hidden")) return true;
    if (classes.contains("-m-5") && classes.contains("mb-2")) return true;
    return false;
  };

  // Walk up from an ad node to the outermost ad-slot wrapper.
  const adSlotOf = (node) => {
    let slot = node;
    let parent = node.parentElement;
    for (let depth = 0; parent && depth < 4; depth++) {
      if (!adSlotWrappers(parent)) break;
      slot = parent;
      parent = parent.parentElement;
    }
    return slot;
  };

  const containsAdMarkup = (el) =>
    !!(el.querySelector &&
      el.querySelector(
        "iframe,script[src],[id^='ts_ms_'],a[href*='bit.ly'],a[href*='mayzaent'],a[href*='mavrtracktor'],a[href*='myavlive'],a[href*='tsyndicate']"
      ));

  const removeNode = (el) => {
    try {
      el.remove();
    } catch {
      // ignore
    }
  };

  const isAdLink = (anchor) => {
    const href = anchor.getAttribute("href") || anchor.href || "";
    if (!href || /^javascript:/i.test(href)) return false;
    return isAdUrl(href);
  };

  const cleanPage = () => {
    if (!missavContext()) return;

    // Known fixed ad blocks. .space-y-6.mb-6 / .space-y-5.mb-5 are generic
    // Tailwind combos, so only drop them when they actually hold an ad.
    for (const selector of ["#html-ads", ".under_player", "[x-ref='stripchat']", "[id^='ts_ms_']"]) {
      document.querySelectorAll(selector).forEach(removeNode);
    }
    for (const selector of [".space-y-6.mb-6", ".space-y-5.mb-5"]) {
      document.querySelectorAll(selector).forEach((el) => {
        if (containsAdMarkup(el)) removeNode(el);
      });
    }
    document.querySelectorAll("div.fixed.right-2.bottom-2").forEach((el) => {
      if (containsAdMarkup(el)) removeNode(el);
    });

    // Any ad iframe / script anywhere on the page.
    document.querySelectorAll("iframe").forEach((frame) => {
      if (isAdUrl(frame.getAttribute("src") || frame.src || "")) removeNode(adSlotOf(frame));
    });
    document.querySelectorAll("script[src]").forEach((script) => {
      if (isAdUrl(script.getAttribute("src") || script.src || "")) removeNode(script);
    });

    // Partner links (casino / VPN / live-sex banners in the nav menu, etc).
    document.querySelectorAll("a[href]").forEach((anchor) => {
      if (isAdLink(anchor)) removeNode(anchor);
    });

    installExportButton();
  };

  const addStyle = () => {
    if (document.getElementById("missav-adblock-style") || !document.documentElement) return;
    const style = document.createElement("style");
    style.id = "missav-adblock-style";
    style.textContent = `
      #html-ads,
      .under_player,
      [id^="ts_ms_"] {
        display: none !important;
        pointer-events: none !important;
      }
    `;
    document.documentElement.appendChild(style);
  };

  // ---------------------------------------------------------------- export ---

  let lastStreamUrl = "";

  const recordStreamUrl = (value) => {
    const text = String(value || "");
    if (!/\.m3u8(?:[?#].*)?$/i.test(text)) return;
    try {
      lastStreamUrl = new URL(text, location.href).href;
    } catch {
      // ignore
    }
  };

  const installStreamRecorder = () => {
    try {
      const nativeFetch = window.fetch;
      if (nativeFetch && !nativeFetch.__missavStreamWrapped) {
        const wrappedFetch = function (input, init) {
          try {
            recordStreamUrl(typeof input === "string" ? input : input && input.url);
          } catch {
            // ignore
          }
          return nativeFetch.call(this, input, init).then((response) => {
            try {
              recordStreamUrl(response && response.url);
            } catch {
              // ignore
            }
            return response;
          });
        };
        wrappedFetch.__missavStreamWrapped = true;
        window.fetch = wrappedFetch;
      }
    } catch {
      // best effort
    }

    try {
      const nativeXhrOpen = XMLHttpRequest.prototype.open;
      if (nativeXhrOpen && !nativeXhrOpen.__missavStreamWrapped) {
        XMLHttpRequest.prototype.open = function (method, url, ...args) {
          try {
            recordStreamUrl(url);
          } catch {
            // ignore
          }
          return nativeXhrOpen.call(this, method, url, ...args);
        };
        XMLHttpRequest.prototype.open.__missavStreamWrapped = true;
      }
    } catch {
      // best effort
    }

    document.addEventListener("DOMContentLoaded", () => {
      document.querySelectorAll("script").forEach((script) => {
        const pattern = /https?:\/\/[^"'<>\s\\]+?\.m3u8(?:\?[^"'<>\s\\]*)?/gi;
        for (const match of String(script.textContent || "").matchAll(pattern)) recordStreamUrl(match[0]);
      });
    });
  };

  const streamUrl = () => {
    try {
      if (window.hls && typeof window.hls.url === "string" && window.hls.url) return window.hls.url;
    } catch {
      // ignore
    }
    try {
      if (typeof window.urlPlay === "string" && window.urlPlay) return window.urlPlay;
    } catch {
      // ignore
    }
    return lastStreamUrl;
  };

  const playerVideo = () => document.querySelector("video.player") || document.querySelector("video");

  const formatClock = (seconds, withFraction = false) => {
    seconds = Math.max(0, Number(seconds) || 0);
    const whole = Math.floor(seconds);
    const hh = String(Math.floor(whole / 3600)).padStart(2, "0");
    const mm = String(Math.floor((whole % 3600) / 60)).padStart(2, "0");
    const ss = String(whole % 60).padStart(2, "0");
    if (!withFraction) return `${hh}:${mm}:${ss}`;
    const fraction = Math.round((seconds - whole) * 100);
    return `${hh}:${mm}:${ss}.${String(fraction).padStart(2, "0")}`;
  };

  const quoteCmdArg = (value) => `"${String(value || "").replace(/"/g, "'")}"`;

  const buildExportText = () => {
    const stream = streamUrl();
    const title = (document.querySelector("h1") && document.querySelector("h1").textContent.trim()) || document.title || "";
    const video = playerVideo();
    const current = video && Number.isFinite(Number(video.currentTime)) ? Number(video.currentTime) : 0;
    const duration = video && Number.isFinite(Number(video.duration)) ? Number(video.duration) : 0;
    const userAgent = navigator.userAgent;
    const referer = location.href;
    const potPlayer = `${quoteCmdArg("C:\\Program Files\\DAUM\\PotPlayer\\PotPlayerMini64.exe")} ${quoteCmdArg(stream)} /user_agent=${quoteCmdArg(userAgent)} /referer=${quoteCmdArg(referer)} /seek=${formatClock(current, true)} /new`;

    return [
      "MissAV Export",
      `Title: ${title}`,
      `Page: ${referer}`,
      `Start: ${formatClock(current, true)} (${current.toFixed(2)}s)`,
      duration ? `Duration: ${formatClock(duration, true)} (${duration.toFixed(2)}s)` : "Duration: unknown",
      "",
      "Stream URL (HLS):",
      stream || "(not captured yet)",
      "",
      "Referer:",
      referer,
      "",
      "PotPlayer:",
      potPlayer
    ].join("\n");
  };

  const copyText = async (text) => {
    try {
      if (typeof GM_setClipboard === "function") {
        GM_setClipboard(text, "text");
        return true;
      }
    } catch {
      // fall through
    }
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  };

  const showExportPanel = (text) => {
    document.getElementById(exportPanelId)?.remove();

    const panel = document.createElement("div");
    panel.id = exportPanelId;
    panel.style.cssText = [
      "position:fixed",
      "right:16px",
      "bottom:16px",
      "z-index:2147483647",
      "width:min(680px,calc(100vw - 32px))",
      "background:#111",
      "color:#eee",
      "border:1px solid #444",
      "box-shadow:0 8px 24px rgba(0,0,0,.35)",
      "padding:10px",
      "font:12px/1.4 Consolas,monospace"
    ].join(";");

    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "关闭";
    close.style.cssText = "cursor:pointer;margin-bottom:8px";
    close.addEventListener("click", () => panel.remove());

    const area = document.createElement("textarea");
    area.value = text;
    area.readOnly = true;
    area.style.cssText = [
      "box-sizing:border-box",
      "width:100%",
      "height:200px",
      "background:#050505",
      "color:#eee",
      "border:1px solid #333",
      "padding:8px",
      "font:12px/1.4 Consolas,monospace",
      "resize:vertical"
    ].join(";");
    area.addEventListener("focus", () => area.select());

    panel.append(close, area);
    document.documentElement.appendChild(panel);
    area.focus();
  };

  const exportCurrentStream = async (button) => {
    const text = buildExportText();
    const copied = await copyText(text);
    showExportPanel(text);
    if (button) {
      const original = button.textContent;
      button.textContent = copied ? "已复制" : "已生成";
      setTimeout(() => {
        button.textContent = original;
      }, 1200);
    }
  };

  const installExportButton = () => {
    if (!missavContext() || !topLevel()) return;
    if (!document.body || document.getElementById(exportButtonId)) return;

    const button = document.createElement("button");
    button.id = exportButtonId;
    button.type = "button";
    button.textContent = "导出链接";
    button.title = "复制当前 HLS 流地址与 PotPlayer 命令";
    button.style.cssText = [
      "position:fixed",
      "left:10px",
      "bottom:10px",
      "z-index:2147483646",
      "padding:2px 8px",
      "cursor:pointer",
      "border:1px solid #777",
      "border-radius:4px",
      "background:#222",
      "color:#fff",
      "font:12px/1.6 Arial,sans-serif",
      "opacity:.85"
    ].join(";");
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      exportCurrentStream(button);
    });
    document.body.appendChild(button);
  };

  // ------------------------------------------------------------------ boot ---

  const closeBlockedPopup = () => {
    // An ad page opened as a tab by the site: close it again.
    if (!topLevel() || !window.opener || !adFrameContext()) return false;
    try {
      window.close();
    } catch {
      // ignore
    }
    if (!window.closed) location.replace("about:blank#missav-blocked");
    return true;
  };

  let cleanScheduled = false;
  const scheduleClean = () => {
    if (cleanScheduled) return;
    cleanScheduled = true;
    setTimeout(() => {
      cleanScheduled = false;
      cleanPage();
    }, 30);
  };

  const observe = () => {
    const target = document.documentElement || document;
    try {
      new MutationObserver(scheduleClean).observe(target, { childList: true, subtree: true });
    } catch {
      // ignore
    }
  };

  const start = () => {
    if (closeBlockedPopup()) return;

    const relevant = missavContext() || adFrameContext();
    if (!relevant) return;

    installPopupGuard();
    installResourceGuard();
    observe();

    if (!missavContext()) {
      // Pure ad frame: only the popup guard matters, blank the content out.
      document.addEventListener("DOMContentLoaded", () => {
        try {
          if (document.body) document.body.style.display = "none";
        } catch {
          // ignore
        }
      });
      return;
    }

    addStyle();
    installStreamRecorder();

    const boot = () => {
      addStyle();
      cleanPage();
      installExportButton();
      setInterval(cleanPage, 1000);
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot, { once: true });
    } else {
      boot();
    }
    cleanPage();
  };

  const waitForDocument = () => {
    if (!document.documentElement) {
      setTimeout(waitForDocument, 10);
      return;
    }
    start();
  };

  waitForDocument();
})();
