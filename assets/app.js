/* Client-side filtering, URL-synced state, and small conveniences. Vanilla JS, no build step. */
(function () {
  "use strict";
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  // ---------- toolbar height for sticky day headers ----------
  const toolbar = $(".toolbar");
  function measure() {
    document.documentElement.style.setProperty("--toolbar-h", toolbar ? toolbar.offsetHeight + "px" : "0px");
  }
  if (toolbar) { measure(); window.addEventListener("resize", measure); }

  // ---------- filter state ----------
  const list = $("[data-agenda]");
  if (list && toolbar) {
    const today = list.dataset.today; // YYYY-MM-DD
    const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
    const state = { q: "", range: toolbar.dataset.defaultRange || "all", cats: new Set(), food: false, req: false, rsvp: false, virtual: false, cancelled: false, hidden: false, group: "" };

    function readUrl() {
      const p = new URLSearchParams(location.search);
      state.q = p.get("q") || "";
      if (p.get("range")) state.range = p.get("range");
      state.cats = new Set((p.get("cat") || "").split(",").filter(Boolean));
      for (const k of ["food", "req", "rsvp", "virtual", "cancelled", "hidden"]) state[k] = p.get(k) === "1";
      state.group = p.get("group") || "";
    }
    function writeUrl() {
      const p = new URLSearchParams();
      if (state.q) p.set("q", state.q);
      if (state.range !== (toolbar.dataset.defaultRange || "all")) p.set("range", state.range);
      if (state.cats.size) p.set("cat", Array.from(state.cats).join(","));
      for (const k of ["food", "req", "rsvp", "virtual", "cancelled", "hidden"]) if (state[k]) p.set(k, "1");
      if (state.group) p.set("group", state.group);
      const qs = p.toString();
      history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + location.hash);
    }
    function inRange(date) {
      switch (state.range) {
        case "today": return date === today;
        case "week": return date >= today && date <= addDays(today, 6);
        case "2w": return date >= today && date <= addDays(today, 13);
        case "past": return date < today;
        default: return date >= today;
      }
    }
    function apply() {
      const q = state.q.trim().toLowerCase();
      let shown = 0;
      for (const ev of $$(".event", list)) {
        const d = ev.dataset;
        let ok = inRange(d.date);
        if (ok && q) ok = d.text.includes(q);
        if (ok && state.cats.size) ok = state.cats.has(d.cat);
        if (ok && state.food) ok = d.food === "1";
        if (ok && state.req) ok = d.req === "1";
        if (ok && state.rsvp) ok = d.rsvp === "1";
        if (ok && state.virtual) ok = d.virtual === "1";
        if (ok && !state.cancelled) ok = d.cancelled !== "1";
        if (ok && !state.hidden) ok = d.hidden !== "1";
        if (ok && state.group) ok = d.group === state.group;
        ev.hidden = !ok;
        if (ok) shown++;
      }
      for (const day of $$(".day", list)) {
        let any = false, n = day.nextElementSibling;
        while (n && !n.classList.contains("day")) { if (n.classList.contains("event") && !n.hidden) { any = true; break; } n = n.nextElementSibling; }
        day.hidden = !any;
      }
      const empty = $("[data-empty]");
      if (empty) empty.style.display = shown ? "none" : "block";
      const count = $("[data-count]");
      if (count) count.textContent = shown === 1 ? "1 event" : shown + " events";
      // reflect state in controls
      $$(".seg button", toolbar).forEach(b => b.setAttribute("aria-pressed", b.dataset.range === state.range));
      $$(".chip[data-cat]", toolbar).forEach(c => c.setAttribute("aria-pressed", state.cats.has(c.dataset.cat)));
      $$(".chip[data-flag]", toolbar).forEach(c => c.setAttribute("aria-pressed", !!state[c.dataset.flag]));
      const g = $("select[data-group]", toolbar); if (g) g.value = state.group;
      const s = $("input[data-search]", toolbar); if (s && s.value !== state.q) s.value = state.q;
      const clear = $(".chip.clear", toolbar);
      if (clear) clear.hidden = !(state.q || state.cats.size || state.food || state.req || state.rsvp || state.virtual || state.group || state.cancelled);
      writeUrl();
      measure();
    }
    // controls
    $$(".seg button", toolbar).forEach(b => b.addEventListener("click", () => { state.range = b.dataset.range; apply(); }));
    $$(".chip[data-cat]", toolbar).forEach(c => c.addEventListener("click", () => { state.cats.has(c.dataset.cat) ? state.cats.delete(c.dataset.cat) : state.cats.add(c.dataset.cat); apply(); }));
    $$(".chip[data-flag]", toolbar).forEach(c => c.addEventListener("click", () => { state[c.dataset.flag] = !state[c.dataset.flag]; apply(); }));
    const groupSel = $("select[data-group]", toolbar);
    if (groupSel) groupSel.addEventListener("change", () => { state.group = groupSel.value; apply(); });
    const search = $("input[data-search]", toolbar);
    if (search) {
      let t; search.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { state.q = search.value; apply(); }, 120); });
      search.addEventListener("keydown", e => { if (e.key === "Escape") { search.value = ""; state.q = ""; apply(); search.blur(); } });
      document.addEventListener("keydown", e => { if (e.key === "/" && document.activeElement !== search && !/input|textarea|select/i.test(document.activeElement.tagName)) { e.preventDefault(); search.focus(); } });
    }
    const clearBtn = $(".chip.clear", toolbar);
    if (clearBtn) clearBtn.addEventListener("click", () => { state.q = ""; state.cats.clear(); state.food = state.req = state.rsvp = state.virtual = state.cancelled = false; state.group = ""; apply(); });
    readUrl();
    apply();
  }

  // ---------- toast ----------
  function toast(msg) {
    let t = $(".toast"); if (!t) { t = document.createElement("div"); t.className = "toast"; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 1800);
  }

  // ---------- copy link ----------
  $$("[data-copy-link]").forEach(b => b.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(location.href); toast("Link copied"); } catch (e) { toast("Copy failed"); }
  }));

  // ---------- add to calendar (.ics) ----------
  function icsDate(iso) { return iso.replace(/[-:]/g, "").slice(0, 15); }
  function esc(s) { return String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n"); }
  $$("[data-ics]").forEach(b => b.addEventListener("click", () => {
    const d = b.dataset;
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//eventscan//EN", "BEGIN:VEVENT", "UID:eventscan-" + d.id + "@local",
      "DTSTAMP:" + icsDate(new Date().toISOString())];
    if (d.allday === "1") {
      const day = d.start.slice(0, 10).replace(/-/g, ""); const next = new Date(d.start.slice(0, 10) + "T00:00:00"); next.setDate(next.getDate() + 1);
      lines.push("DTSTART;VALUE=DATE:" + day, "DTEND;VALUE=DATE:" + next.toISOString().slice(0, 10).replace(/-/g, ""));
    } else {
      lines.push("DTSTART:" + icsDate(d.start), "DTEND:" + icsDate(d.end));
    }
    lines.push("SUMMARY:" + esc(d.title));
    if (d.loc) lines.push("LOCATION:" + esc(d.loc));
    if (d.desc) lines.push("DESCRIPTION:" + esc(d.desc));
    if (d.url) lines.push("URL:" + d.url);
    lines.push("END:VEVENT", "END:VCALENDAR");
    const blob = new Blob([lines.join("\r\n") + "\r\n"], { type: "text/calendar;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = (d.title || "event").replace(/[^\w\- ]+/g, "").trim().slice(0, 60) + ".ics";
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }));

  // ---------- relative dates on RSVP page ----------
  $$("[data-due]").forEach(el => {
    const due = new Date(el.dataset.due); const now = new Date();
    const days = Math.floor((new Date(due.getFullYear(), due.getMonth(), due.getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
    let label = days < 0 ? "closed" : days === 0 ? "due today" : days === 1 ? "due tomorrow" : "due in " + days + " days";
    el.textContent = label + " · " + el.dataset.dueLabel;
    el.classList.toggle("urgent", days <= 1 && days >= 0); el.classList.toggle("soon", days > 1 && days <= 4);
  });
})();
