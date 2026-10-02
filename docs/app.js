(function () {
  const PAGE = 60;
  const $ = (id) => document.getElementById(id);
  const state = { feed: null, newIds: new Set(), shown: PAGE };

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

  function renderWatch(w, byId) {
    const order = { OPEN: 0, POSTED: 1, NOT_YET: 2 };
    const items = w.items.slice().sort((a, b) => order[a.status] - order[b.status]);
    $("watch").innerHTML = items.map((i) => {
      const hits = (i.matches || []).map((id) => byId[id]).filter(Boolean).slice(0, 3);
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

  function filtered() {
    const q = $("q").value.trim().toLowerCase();
    const cat = $("category").value;
    const min = +$("minMatch").value;
    const us = $("usOnly").checked;
    const hideGrad = $("hideGrad").checked;
    const newOnly = $("newOnly").checked;
    const weekAgo = Date.now() / 1000 - 7 * 86400;
    let list = state.feed.postings.filter((p) => {
      if (p.match.score < min) return false;
      if (cat && p.category !== cat) return false;
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
    const why = p.match.reasons.length ? p.match.reasons.join(", ") : "no skill keywords matched";
    const locs = p.locations.slice(0, 3).join(" · ") + (p.locations.length > 3 ? ` +${p.locations.length - 3}` : "");
    return `<article class="card">
      <div class="co"><span>${esc(p.company)}</span>${isNew ? '<span class="new">NEW</span>' : ""}</div>
      <h3>${esc(p.title)}</h3>
      <div class="loc">${esc(locs || "Location not listed")}</div>
      <div class="row">
        <span class="badge ${p.match.label}" title="Heuristic: ${esc(why)}">${p.match.label} match · ${p.match.score}</span>
        ${p.category ? `<span class="flag">${esc(p.category)}</span>` : ""}
        ${p.flags.map((f) => `<span class="flag ${flagClass(f)}">${esc(f)}</span>`).join("")}
      </div>
      <div class="foot">
        <span title="First seen by this feed: ${new Date(p.first_seen * 1000).toLocaleDateString()}">Posted ${ago(p.posted || p.first_seen)}</span>
        <a href="${esc(p.url)}" target="_blank" rel="noopener">Apply →</a>
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
    if (cfg.trackerUrl) { $("trackerLink").href = cfg.trackerUrl; $("trackerLink").hidden = false; }
    const get = (f) => fetch("data/" + f, { cache: "no-cache" }).then((r) => r.json());
    const [feed, watch, changes] = await Promise.all([get("feed.json"), get("watchlist.json"), get("changes.json")]);
    state.feed = feed;
    if (!changes.baseline) state.newIds = new Set(changes.new_ids);
    const byId = Object.fromEntries(feed.postings.map((p) => [p.id, p]));
    const bad = feed.sources.filter((s) => !s.ok).map((s) => s.name);
    $("term").textContent = feed.term;
    $("meta").textContent = `Updated ${new Date(feed.generated_at * 1000).toLocaleString()} · ${feed.count} postings from ${feed.sources.length} sources` +
      (changes.baseline ? "" : ` · ${changes.new_count} new since last run`) + (bad.length ? ` · failed: ${bad.join(", ")}` : "");
    const cats = [...new Set(feed.postings.map((p) => p.category).filter(Boolean))].sort();
    $("category").insertAdjacentHTML("beforeend", cats.map((c) => `<option>${esc(c)}</option>`).join(""));
    renderWatch(watch, byId);
    render();
  }

  $("filters").addEventListener("input", () => { state.shown = PAGE; render(); });
  $("more").addEventListener("click", () => { state.shown += PAGE; render(); });
  load().catch((e) => { $("meta").textContent = "Could not load feed data: " + e; });
})();
