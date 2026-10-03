// Run with: node scripts/test-popup-scope.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../supjav-popup-blocker.user.js"), "utf8");

function simulate(url, { referrer = "", frame = false, opener = false, title = "Ordinary page", loading = false } = {}) {
  const result = { scripts: 0, closes: 0, redirects: [], storageReads: 0, storageWrites: 0 };
  const listeners = new Map();
  const nativeOpen = () => "native-window";
  const ancestor = { open: nativeOpen, postMessage() {} };
  let context;
  let links;

  // Only the DOM operations used by startup/guards are needed; no media/network.
  class Element {
    constructor(tagName = "DIV") {
      this.tagName = tagName;
      this.nodeType = 1;
      this.attributes = new Map();
      this.dataset = {};
      this.style = {};
      this.textContent = "";
    }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    hasAttribute(name) { return this.attributes.has(name); }
    removeAttribute(name) { this.attributes.delete(name); }
    matches(selector) { return this.tagName === "A" && this.hasAttribute("href") && selector.includes("a[href]"); }
    querySelectorAll(selector) { return this.tagName === "HTML" && selector.includes("a[href]") ? links : []; }
    appendChild(node) {
      if (node.tagName === "SCRIPT") {
        result.scripts++;
        vm.runInContext(node.textContent, context);
      }
      return node;
    }
    remove() {}
  }
  class HTMLAnchorElement extends Element {
    constructor(href, target = "") {
      super("A");
      this.setAttribute("href", href);
      if (target) this.setAttribute("target", target);
    }
    get href() { return this.getAttribute("href"); }
    get target() { return this.getAttribute("target") || ""; }
    click() { return "native-click"; }
  }
  class Window {}
  Window.prototype.open = nativeOpen;
  const nativeClick = HTMLAnchorElement.prototype.click;
  const nativeSetAttribute = Element.prototype.setAttribute;
  links = [
    new HTMLAnchorElement("https://example.net/", "_blank"),
    new HTMLAnchorElement("blob:https://example.org/file"),
    new HTMLAnchorElement("https://example.net/file"),
    new HTMLAnchorElement("https://supjav.com/video", "_blank")
  ];
  links[2].setAttribute("download", "file");
  const originalLinks = links.map(link => [...link.attributes]);
  const sandbox = {
    URL, console, Element, HTMLAnchorElement, Window,
    location: Object.assign(new URL(url), { replace: value => result.redirects.push(value) }),
    navigator: { userAgent: "scope-regression-test" },
    open: nativeOpen,
    opener: opener ? ancestor : null,
    closed: false,
    close() { result.closes++; },
    // An old installation may have left an active cross-tab guard in storage.
    GM_getValue() { result.storageReads++; return Date.now() + 8000; },
    GM_setValue() { result.storageWrites++; },
    MutationObserver: class { observe() {} },
    setTimeout() {},
    setInterval() {},
    addEventListener() {},
    postMessage() {},
    document: {
      title, referrer, readyState: loading ? "loading" : "complete",
      body: { innerText: "Ordinary content" },
      documentElement: new Element("HTML"),
      createElement: tag => new Element(tag.toUpperCase()),
      querySelector: () => null,
      querySelectorAll: () => [],
      getElementById: () => null,
      addEventListener(type, callback) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(callback);
      }
    }
  };
  sandbox.window = sandbox.self = sandbox;
  sandbox.top = sandbox.parent = frame ? ancestor : sandbox;
  context = vm.createContext(sandbox);
  vm.runInContext(source, context, { filename: "supjav-popup-blocker.user.js" });
  return { sandbox, result, links, originalLinks, nativeOpen, nativeClick, nativeSetAttribute, ancestor, listeners };
}

function assertUnaffected(url, options) {
  const state = simulate(url, options);
  const { sandbox, result, links, originalLinks, nativeOpen, nativeClick, nativeSetAttribute } = state;
  assert.equal(result.scripts, 0, `${url}: must not inject patches`);
  assert.equal(result.closes, 0, `${url}: must not close`);
  assert.deepEqual(result.redirects, []);
  assert.equal(result.storageReads + result.storageWrites, 0);
  assert.equal(sandbox.open, nativeOpen);
  assert.equal(sandbox.Window.prototype.open, nativeOpen);
  assert.equal(sandbox.HTMLAnchorElement.prototype.click, nativeClick);
  assert.equal(sandbox.Element.prototype.setAttribute, nativeSetAttribute);
  assert.deepEqual(links.map(link => [...link.attributes]), originalLinks);
  assert.equal(sandbox.open("https://example.net/", "_blank"), "native-window");
  assert.equal(links[2].click(), "native-click");
  return state;
}

function assertProtected(state) {
  const { sandbox, result, ancestor, nativeOpen, links } = state;
  assert.equal(result.scripts, 2, `${sandbox.location.href}: both guards must initialize`);
  assert.equal(sandbox.__supjavBlankTabBlocker, true);
  assert.equal(sandbox.__supjavPopupBlocker, true);
  assert.equal(sandbox.__supjavExportReceiverInstalled, true);
  assert.equal(result.closes, 0, "player pages must not be closed");
  assert.deepEqual(result.redirects, []);
  assert.equal(result.storageReads + result.storageWrites, 0);
  assert.equal(ancestor.open, nativeOpen, "never patch a parent/top/opener window");
  assert.equal(sandbox.open("https://example.net/", "_blank").location.href, "about:blank");
  assert.equal(sandbox.open("", "_blank").location.href, "about:blank");
  assert.equal(sandbox.open("https://supjav.com/video", "_blank"), "native-window");
  assert.equal(sandbox.open("https://example.net/", "_self"), "native-window");
  assert.equal(links[0].href, "javascript:void 0");
  assert.equal(links[3].href, "https://supjav.com/video");
}

// Normal sites, including misleading URL text and unrelated embedded ad hosts.
for (const url of [
  "https://example.org/",
  "https://example.org/?q=https%3A%2F%2Fsupjav.com",
  "https://example.org/supjav.com/article",
  "https://supjav.com.example.org/",
  "https://supjav.com@example.org/",
  "https://mnaspm.com/",
  "about:blank"
]) assertUnaffected(url);
for (const referrer of ["https://supjav.com/video", "https://voe.sx/e/abc", "https://streamtape.com/e/abc"]) {
  assertUnaffected("https://example.org/article", { referrer, opener: true });
}
assertUnaffected("https://mnaspm.com/ad", { referrer: "https://example.org/", opener: true });
assertUnaffected("https://mnaspm.com/ad", { referrer: "https://example.org/", frame: true });
assertUnaffected("https://example.org/article", { referrer: "https://mnaspm.com/", frame: true });
assertUnaffected("https://mirror.example/e/abc", { referrer: "https://example.org/?site=voe.sx" });
assertUnaffected("https://example.org/search?q=VOE", { title: "VOE Video Cloud - Search" });
assertUnaffected("blob:https://supjav.com/file", { referrer: "https://supjav.com/video", opener: true });
assertUnaffected("about:blank", { referrer: "https://example.org/", frame: true });
assertUnaffected("https://challenges.cloudflare.com/", { referrer: "https://supjav.com/", frame: true });

// Retain main-site/player hooks and export initialization, including standalone players.
for (const host of [
  "supjav.com", "www.supjav.com", "lk1.supremejav.com",
  "emturbovid.com", "turbovidhls.com", "turboviplay.com",
  "fc2stream.tv", "streamtape.com", "streamtape.to", "streamtape.site",
  "voe.sx", "player.voeunblock.com", "player.voeunbl0ck.com"
]) {
  assertProtected(simulate(`https://${host}/e/abc`));
  assertProtected(simulate(`https://${host}/e/abc`, { frame: true, referrer: "https://supjav.com/video" }));
}
assertProtected(simulate("https://mirror.example/e/abc", { referrer: "https://voe.sx/e/abc" }));
assertProtected(simulate("https://mirror.example/e/abc", { referrer: "https://lk1.supremejav.com/", frame: true }));
assertProtected(simulate("https://mirror.example/e/abc", { title: "VOE - Video Cloud" }));
assertProtected(simulate("about:blank", { referrer: "https://supjav.com/video", frame: true }));
assertProtected(simulate("about:blank", { referrer: "https://streamtape.com/e/abc", opener: true }));

// Unknown mirrors can only expose their title after document-start.
const lateMirror = simulate("https://mirror.example/e/abc", { loading: true, title: "" });
assert.equal(lateMirror.result.scripts, 0);
lateMirror.sandbox.document.title = "VOE - Video Cloud";
lateMirror.sandbox.document.readyState = "complete";
for (const callback of [...lateMirror.listeners.get("DOMContentLoaded") || []]) callback();
assertProtected(lateMirror);
const normalLoadingPage = assertUnaffected("https://example.org/", { loading: true });
normalLoadingPage.sandbox.document.readyState = "complete";
for (const callback of [...normalLoadingPage.listeners.get("DOMContentLoaded") || []]) callback();
assert.equal(normalLoadingPage.result.scripts, 0);

// Close only known ad popups with a verified source, not standalone tabs/players.
const adPopup = simulate("https://mnaspm.com/ad", { referrer: "https://supjav.com/video", opener: true });
assert.equal(adPopup.result.closes, 1);
assert.deepEqual(adPopup.result.redirects, ["about:blank#supjav-blocked"]);
assert.equal(adPopup.result.scripts, 0);
assertUnaffected("https://mnaspm.com/ad", { referrer: "https://supjav.com/video" });
console.log("Popup scope regression checks passed.");
