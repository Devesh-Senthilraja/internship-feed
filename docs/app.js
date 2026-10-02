(function () {
  const PAGE = 60;
  const PIN_KEY = "feed-pins-v1";
  const $ = (id) => document.getElementById(id);
  const state = { feed: null, byId: {}, newIds: new Set(), shown: PAGE, pins: loadPins(), trackerUrl: "" };

  function ago(ts) {
    if (!ts) return "date unknown";
    const d = Math.floor((Date.now() / 1000 - ts) / 86400);
    if (d <= 0) return "today";
    if (d === 1) return "1 day ago";
    if (d < 60) return d + " days ago";
    return Math.floor(d / 30) + " months ago";
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function flagClass(f) {
    if (f === "underclass-friendly" || f.endsWith("you qualify")) return "good";
    if (f.startsWith("grad") || f.startsWith("export") || f.startsWith("upperclass")) return "warn";
    return "";
  }

  // ---------- pins (this browser only) ----------
  function loadPins() {
    try { return JSON.parse(localStorage.getItem(PIN_KEY)) || {}; } catch { return {}; }
  }
  function savePins() {
    try { localStorage.setItem(PIN_KEY, JSON.stringify(state.pins)); } catch { /* storage blocked: pins last this visit */ }
  }
  function togglePin(id) {
    if (state.pins[id]) delete state.pins[id];
    else {
      const p = state.byId[id];
      // Keep a snapshot so a pin survives the posting dropping out of the feed.
      if (p) state.pins[id] = { ...p, pinned_at: Math.floor(Date.now() / 1000) };
    }
    savePins();
    renderPins();
    render();
  }

  // ---------- add to tracker ----------
  // The tracker artifact only receives a plain #anchor, so the posting travels as base64url in it.
  function trackerLink(p) {
    const payload = {
      v: 1, c: p.company, t: p.title, u: p.url, l: p.locations.slice(0, 3).join(" · "),
      p: p.posted || p.first_seen || null, cat: p.category || "", m: p.match.score, f: p.flags,
    };
    const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload))))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return state.trackerUrl + "#add-" + b64;
  }

  // ---------- rendering ----------
  function renderWatch(w) {
    const order = { OPEN: 0, POSTED: 1, NOT_YET: 2 };
    const items = w.items.slice().sort((a, b) => order[a.status] - order[b.status]);
    $("watch").innerHTML = items.map((i) => {
      const hits = (i.matches || []).map((id) => state.byId[id]).filter(Boolean).slice(0, 3);
      const label = i.status === "NOT_YET" ? "NOT YET" : i.status;
      const since = i.opened_at ? " · since " + new Date(i.opened_at * 1000).toLocaleDateString() : "";
      return `<div class="wcard">
        <span class="status ${i.status}">${label}</span><span class="hint">${since}</span>
        <h3>${esc(i.name)}</h3>
        ${hits.map((p) => `<p>→ <a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title)}</a></p>`).join("")}
        <p>${esc(i.note || "")}</p>
        ${i.link ? `<p><a href="${esc(i.link)}" target="_blank" rel="noopener">Careers page</a></p>` : ""}
      </div>`;
    }).join("");
  }

  function renderPins() {
    const list = Object.values(state.pins).sort((a, b) => b.pinned_at - a.pinned_at);
    $("pinSection").hidden = !list.length;
    $("pinCount").textContent = list.length ? `(${list.length})` : "";
    $("pins").innerHTML = list.map((p) => card(state.byId[p.id] || { ...p, gone: true })).join("");
  }

  function renderSources(feed) {
    $("sourceList").innerHTML = feed.sources.map((s) => `<li>
      <div class="src-head">
        <span class="src-name">${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a>` : esc(s.name)}</span>
        <span class="src-count ${s.ok ? "" : "bad"}">${!s.ok ? "failed" : s.count < 0 ? -s.count + " removed" : s.count + " postings"}</span>
      </div>
      <div class="src-kind">${esc(s.kind || "")}${s.error ? " · " + esc(s.error) : ""}</div>
    </li>`).join("");
  }

  function filtered() {
    const q = $("q").value.trim().toLowerCase();
    const cat = $("category").value;
    const src = $("source").value;
    const min = +$("minMatch").value;
    const us = $("usOnly").checked;
    const hideGrad = $("hideGrad").checked;
    const newOnly = $("newOnly").checked;
    const weekAgo = Date.now() / 1000 - 7 * 86400;
    let list = state.feed.postings.filter((p) => {
      if (p.match.score < min) return false;
      if (cat && p.category !== cat) return false;
      if (src && p.source !== src && !(p.also_on || []).includes(src)) return false;
      if (us && !p.us) return false;
      if (hideGrad && p.flags.includes("grad-level")) return false;
      if (newOnly && p.first_seen < weekAgo && (p.posted || 0) < weekAgo) return false;
      if (q && !(p.company + " " + p.title + " " + p.locations.join(" ")).toLowerCase().includes(q)) return false;
      return true;
    });
    if ($("sort").value === "match") list = list.slice().sort((a, b) => b.match.score - a.match.score);
    return list;
  }

  function card(p) {
    const isNew = state.newIds.has(p.id);
    const pinned = !!state.pins[p.id];
    const why = p.match.reasons.length ? p.match.reasons.join(", ") : "no skill keywords matched";
    const locs = p.locations.slice(0, 3).join(" · ") + (p.locations.length > 3 ? ` +${p.locations.length - 3}` : "");
    const via = [p.source, ...(p.also_on || [])].join(", ");
    return `<article class="card${pinned ? " pinned" : ""}">
      <div class="co"><span>${esc(p.company)}</span>
        <span class="co-right">${isNew ? '<span class="new">NEW</span>' : ""}${p.gone ? '<span class="gone">No longer listed</span>' : ""}
          <button class="pin" data-pin="${esc(p.id)}" aria-pressed="${pinned}" title="${pinned ? "Unpin" : "Pin to the top of this page (this browser only)"}">${pinned ? "★ Pinned" : "☆ Pin"}</button>
        </span>
      </div>
      <h3>${esc(p.title)}</h3>
      <div class="loc">${esc(locs || "Location not listed")}</div>
      <div class="row">
        <span class="badge ${p.match.label}" title="Heuristic: ${esc(why)}">${p.match.label} match · ${p.match.score}</span>
        ${p.category ? `<span class="flag">${esc(p.category)}</span>` : ""}
        ${p.flags.map((f) => `<span class="flag ${flagClass(f)}">${esc(f)}</span>`).join("")}
      </div>
      <div class="via">via ${esc(via)}</div>
      <div class="foot">
        <span title="First seen by this feed: ${new Date(p.first_seen * 1000).toLocaleDateString()}">Posted ${ago(p.posted || p.first_seen)}</span>
        <span class="actions">
          ${state.trackerUrl ? `<a href="${esc(trackerLink(p))}" data-tracker target="_blank" rel="noopener" title="Copy this posting, then paste it into My Applications">Copy to tracker</a>` : ""}
          <a href="${esc(p.url)}" target="_blank" rel="noopener">Apply →</a>
        </span>
      </div>
    </article>`;
  }

  function render() {
    const list = filtered();
    $("count").textContent = `${list.length} of ${state.feed.count} postings`;
    $("grid").innerHTML = list.slice(0, state.shown).map(card).join("");
    $("more").hidden = list.length <= state.shown;
  }

  async function load() {
    const cfg = window.FEED_CONFIG || {};
    state.trackerUrl = cfg.trackerUrl || "";
    if (state.trackerUrl) { $("trackerLink").href = state.trackerUrl; $("trackerLink").hidden = false; }
    const get = (f) => fetch("data/" + f, { cache: "no-cache" }).then((r) => r.json());
    const [feed, watch, changes] = await Promise.all([get("feed.json"), get("watchlist.json"), get("changes.json")]);
    state.feed = feed;
    if (!changes.baseline) state.newIds = new Set(changes.new_ids);
    state.byId = Object.fromEntries(feed.postings.map((p) => [p.id, p]));
    const bad = feed.sources.filter((s) => !s.ok).map((s) => s.name);
    $("term").textContent = feed.term;
    $("meta").textContent = `Updated ${new Date(feed.generated_at * 1000).toLocaleString()} · ${feed.count} postings from`;
    $("srcBtn").textContent = `${feed.sources.filter((s) => s.count >= 0).length} sources`;
    $("srcBtn").hidden = false;
    $("meta2").textContent = (changes.baseline ? "" : ` · ${changes.new_count} new since last run`) + (bad.length ? ` · failed: ${bad.join(", ")}` : "");
    const cats = [...new Set(feed.postings.map((p) => p.category).filter(Boolean))].sort();
    $("category").insertAdjacentHTML("beforeend", cats.map((c) => `<option>${esc(c)}</option>`).join(""));
    $("source").insertAdjacentHTML("beforeend", feed.sources.filter((s) => s.count > 0).map((s) => `<option>${esc(s.name)}</option>`).join(""));
    renderSources(feed);
    renderWatch(watch);
    renderPins();
    render();
  }

  $("filters").addEventListener("input", () => { state.shown = PAGE; render(); });
  $("more").addEventListener("click", () => { state.shown += PAGE; render(); });
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-pin]");
    if (b) togglePin(b.dataset.pin);
  });
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-tracker]");
    if (!a) return;
    // Belt and braces: the link also goes to the clipboard, so pasting it into the tracker works
    // even if the viewer drops the #add- anchor on the way.
    // The claude.ai viewer drops the #add- anchor, so the clipboard is what actually carries the posting.
    const copied = navigator.clipboard ? navigator.clipboard.writeText(a.href) : Promise.reject();
    copied.then(
      () => toast("Copied. In My Applications, click “Paste from feed” and press Ctrl+V."),
      () => toast("Couldn’t copy automatically. Right-click “Copy to tracker”, choose Copy link, then paste it into “Paste from feed”."));
  });
  function toast(msg) {
    const t = $("toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, 10000);
  }
  $("srcBtn").addEventListener("click", () => $("sources").showModal());
  $("srcClose").addEventListener("click", () => $("sources").close());
  $("sources").addEventListener("click", (e) => { if (e.target === $("sources")) $("sources").close(); });
  load().catch((e) => { $("meta").textContent = "Could not load feed data: " + e; });
})();
