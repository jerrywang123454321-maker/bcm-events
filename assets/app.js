/* Client-side filtering, URL-synced state, month calendar, and small conveniences. Vanilla JS, no build step. */
(function () {
  "use strict";
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const toolbar = $(".toolbar");
  const list = $("[data-agenda]");
  const cal = $("[data-calendar]");
  const today = (list || cal || document.body).dataset.today || (function (d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); })(new Date());
  const localIso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return localIso(d); };

  // ---------- sticky offsets ----------
  function measure() {
    document.documentElement.style.setProperty("--toolbar-h", toolbar ? toolbar.offsetHeight + "px" : "0px");
  }
  if (toolbar) { measure(); window.addEventListener("resize", measure); }

  // ---------- shared filter state ----------
  const FLAGS = ["food", "req", "rsvp", "virtual", "cancelled", "hidden"];
  const state = { q: "", range: (toolbar && toolbar.dataset.defaultRange) || "all", cats: new Set(), food: false, req: false, rsvp: false, virtual: false, cancelled: false, hidden: false, group: "", month: "" };

  function readUrl() {
    const p = new URLSearchParams(location.search);
    state.q = p.get("q") || "";
    if (p.get("range")) state.range = p.get("range");
    state.cats = new Set((p.get("cat") || "").split(",").filter(Boolean));
    for (const k of FLAGS) state[k] = p.get(k) === "1";
    state.group = p.get("group") || "";
    state.month = p.get("m") || "";
  }
  function writeUrl() {
    const p = new URLSearchParams();
    if (state.q) p.set("q", state.q);
    if (toolbar && state.range !== (toolbar.dataset.defaultRange || "all")) p.set("range", state.range);
    if (state.cats.size) p.set("cat", Array.from(state.cats).join(","));
    for (const k of FLAGS) if (state[k]) p.set(k, "1");
    if (state.group) p.set("group", state.group);
    if (state.month && state.month !== today.slice(0, 7)) p.set("m", state.month);
    const qs = p.toString();
    history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + location.hash);
  }
  function inRange(date) {
    if (cal) return true; // the month grid shows every day it draws
    switch (state.range) {
      case "today": return date === today;
      case "week": return date >= today && date <= addDays(today, 6);
      case "2w": return date >= today && date <= addDays(today, 13);
      case "past": return date < today;
      default: return date >= today;
    }
  }
  function matches(d) {
    const q = state.q.trim().toLowerCase();
    let ok = inRange(d.date);
    if (ok && q) ok = (d.text || "").includes(q);
    if (ok && state.cats.size) ok = state.cats.has(d.cat);
    if (ok && state.food) ok = String(d.food) === "1";
    if (ok && state.req) ok = String(d.req) === "1";
    if (ok && state.rsvp) ok = String(d.rsvp) === "1";
    if (ok && state.virtual) ok = String(d.virtual) === "1";
    if (ok && !state.cancelled) ok = String(d.cancelled) !== "1";
    if (ok && !state.hidden) ok = String(d.hidden) !== "1";
    if (ok && state.group) ok = d.group === state.group;
    return ok;
  }
  function syncControls() {
    if (!toolbar) return;
    $$(".seg button", toolbar).forEach(b => b.setAttribute("aria-pressed", b.dataset.range === state.range));
    $$(".chip[data-cat]", toolbar).forEach(c => c.setAttribute("aria-pressed", state.cats.has(c.dataset.cat)));
    $$(".chip[data-flag]", toolbar).forEach(c => c.setAttribute("aria-pressed", !!state[c.dataset.flag]));
    const g = $("select[data-group]", toolbar); if (g) g.value = state.group;
    const s = $("input[data-search]", toolbar); if (s && s.value !== state.q) s.value = state.q;
    const clear = $(".chip.clear", toolbar);
    if (clear) clear.hidden = !(state.q || state.cats.size || state.food || state.req || state.rsvp || state.virtual || state.group || state.cancelled);
  }
  function apply() {
    let shown = 0;
    if (list) {
      for (const ev of $$(".event", list)) { const ok = matches(ev.dataset); ev.hidden = !ok; if (ok) shown++; }
      for (const day of $$(".day", list)) {
        let any = false, n = day.nextElementSibling;
        while (n && !n.classList.contains("day")) { if (n.classList.contains("event") && !n.hidden) { any = true; break; } n = n.nextElementSibling; }
        day.hidden = !any;
      }
      const empty = $("[data-empty]"); if (empty) empty.style.display = shown ? "none" : "block";
    }
    if (cal) shown = renderCalendar();
    const count = $("[data-count]"); if (count) count.textContent = shown === 1 ? "1 event" : shown + " events";
    syncControls(); writeUrl(); measure();
  }
  if (toolbar) {
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
    if (clearBtn) clearBtn.addEventListener("click", () => { state.q = ""; state.cats.clear(); for (const k of FLAGS) state[k] = false; state.group = ""; apply(); });
  }

  // ---------- month calendar ----------
  let events = [];
  let selectedDay = today;
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  function eventUrl(id) { return (cal.dataset.eventUrl || "/event/{id}").replace("{id}", id); }
  function esc(s) { return String(s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function renderCalendar() {
    if (!state.month) state.month = today.slice(0, 7);
    const [y, m] = state.month.split("-").map(Number);
    const first = new Date(y, m - 1, 1);
    const start = new Date(first); start.setDate(1 - first.getDay());
    const label = $("[data-cal-label]"); if (label) label.textContent = MONTHS[m - 1] + " " + y;
    const visible = events.filter(matches);
    const byDay = {};
    for (const e of visible) (byDay[e.date] = byDay[e.date] || []).push(e);
    let html = DOW.map(d => `<div class="dow">${d}</div>`).join("");
    let inMonthShown = 0;
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const iso = localIso(d);
      const inMonth = d.getMonth() === m - 1;
      const dayEvents = (byDay[iso] || []).sort((a, b) => a.sort.localeCompare(b.sort));
      if (inMonth) inMonthShown += dayEvents.length;
      const cls = ["cell", inMonth ? "" : "out", iso === today ? "today" : "", iso === selectedDay ? "selected" : "", dayEvents.length ? "has" : ""].join(" ");
      const chips = dayEvents.slice(0, 3).map(e => `<a class="chip-ev cat-${esc(e.cat)} ${e.cancelled ? "cancelled" : ""}" href="${eventUrl(e.id)}" title="${esc(e.title)}${e.loc ? " · " + esc(e.loc) : ""}"><span class="t">${esc(e.time)}</span>${esc(e.title)}</a>`).join("");
      const more = dayEvents.length > 3 ? `<button type="button" class="more" data-day="${iso}">+${dayEvents.length - 3} more</button>` : "";
      const dots = dayEvents.slice(0, 4).map(e => `<i class="dot cat-${esc(e.cat)}"></i>`).join("");
      html += `<div class="${cls}" data-day="${iso}" role="button" tabindex="0" aria-label="${d.toDateString()}, ${dayEvents.length} events"><div class="num">${d.getDate()}</div><div class="chips-ev">${chips}${more}</div><div class="dots">${dots}${dayEvents.length > 4 ? `<span class="n">+${dayEvents.length - 4}</span>` : ""}</div></div>`;
    }
    $("[data-grid]", cal).innerHTML = html;
    renderDayList(byDay[selectedDay] || []);
    return inMonthShown;
  }
  function renderDayList(dayEvents) {
    const box = $("[data-daylist]", cal); if (!box) return;
    const d = new Date(selectedDay + "T00:00:00");
    const head = d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) + (selectedDay === today ? " · Today" : "");
    if (!dayEvents.length) { box.innerHTML = `<h2 class="section">${esc(head)}</h2><div class="empty small">Nothing on this day.</div>`; return; }
    box.innerHTML = `<h2 class="section">${esc(head)}</h2>` + dayEvents.sort((a, b) => a.sort.localeCompare(b.sort)).map(e =>
      `<a class="dl-item ${e.cancelled ? "cancelled" : ""}" href="${eventUrl(e.id)}"><span class="t">${esc(e.time)}</span><span class="body"><span class="title">${esc(e.title)}</span>${e.loc ? `<span class="meta">${esc(e.loc)}</span>` : ""}</span><span class="badges">${e.req ? '<span class="badge req">Required</span>' : ""}${e.rsvp ? '<span class="badge rsvp">RSVP</span>' : ""}${e.food ? '<span class="badge food">Food</span>' : ""}</span></a>`).join("");
  }
  if (cal) {
    try { events = JSON.parse($("#events-data").textContent); } catch (e) { events = []; }
    if (events.length && !events.some(e => e.date >= today)) selectedDay = today;
    $("[data-cal-prev]", cal).addEventListener("click", () => { const [y, m] = state.month.split("-").map(Number); const d = new Date(y, m - 2, 1); state.month = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); selectedDay = state.month === today.slice(0, 7) ? today : state.month + "-01"; apply(); });
    $("[data-cal-next]", cal).addEventListener("click", () => { const [y, m] = state.month.split("-").map(Number); const d = new Date(y, m, 1); state.month = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); selectedDay = state.month === today.slice(0, 7) ? today : state.month + "-01"; apply(); });
    $("[data-cal-today]", cal).addEventListener("click", () => { state.month = today.slice(0, 7); selectedDay = today; apply(); });
    $("[data-grid]", cal).addEventListener("click", e => {
      const more = e.target.closest(".more"); const cell = e.target.closest(".cell");
      if (e.target.closest("a")) return;
      if (more || cell) { selectedDay = (more || cell).dataset.day; renderCalendar(); if (more || window.innerWidth < 640) $("[data-daylist]", cal).scrollIntoView({ behavior: "smooth", block: "start" }); }
    });
    $("[data-grid]", cal).addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && e.target.classList.contains("cell")) { e.preventDefault(); selectedDay = e.target.dataset.day; renderCalendar(); } });
  }

  readUrl();
  if (cal && state.month && state.month !== today.slice(0, 7)) selectedDay = state.month + "-01";
  apply();

  // ---------- theme toggle ----------
  $$("[data-theme-toggle]").forEach(b => b.addEventListener("click", () => {
    const root = document.documentElement;
    const dark = root.getAttribute("data-theme") === "dark" || (!root.getAttribute("data-theme") && root.classList.contains("system-dark"));
    const next = dark ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem("theme", next); } catch (e) {}
  }));

  // ---------- jump to today ----------
  $$("[data-jump-today]").forEach(b => b.addEventListener("click", () => {
    const target = $(".day.today:not([hidden])") || $$(".day").find(d => !d.hidden && d.nextElementSibling && d.dataset.date >= today);
    if (target) { const y = target.getBoundingClientRect().top + window.scrollY - (56 + (toolbar ? toolbar.offsetHeight : 0)) - 4; window.scrollTo({ top: y, behavior: "smooth" }); }
  }));

  // ---------- toast ----------
  function toast(msg) {
    let t = $(".toast"); if (!t) { t = document.createElement("div"); t.className = "toast"; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 1800);
  }
  $$("[data-copy-link]").forEach(b => b.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(location.href); toast("Link copied"); } catch (e) { toast("Copy failed"); }
  }));

  // ---------- add to calendar (.ics) ----------
  function icsDate(iso) { return iso.replace(/[-:]/g, "").slice(0, 15); }
  function icsEsc(s) { return String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n"); }
  $$("[data-ics]").forEach(b => b.addEventListener("click", () => {
    const d = b.dataset;
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//eventscan//EN", "BEGIN:VEVENT", "UID:eventscan-" + d.id + "@local", "DTSTAMP:" + icsDate(new Date().toISOString())];
    if (d.allday === "1") {
      const day = d.start.slice(0, 10).replace(/-/g, ""); const next = new Date(d.start.slice(0, 10) + "T00:00:00"); next.setDate(next.getDate() + 1);
      lines.push("DTSTART;VALUE=DATE:" + day, "DTEND;VALUE=DATE:" + localIso(next).replace(/-/g, ""));
    } else {
      lines.push("DTSTART:" + icsDate(d.start), "DTEND:" + icsDate(d.end));
    }
    lines.push("SUMMARY:" + icsEsc(d.title));
    if (d.loc) lines.push("LOCATION:" + icsEsc(d.loc));
    if (d.desc) lines.push("DESCRIPTION:" + icsEsc(d.desc));
    if (d.url) lines.push("URL:" + d.url);
    lines.push("END:VEVENT", "END:VCALENDAR");
    const blob = new Blob([lines.join("\r\n") + "\r\n"], { type: "text/calendar;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = (d.title || "event").replace(/[^\w\- ]+/g, "").trim().slice(0, 60) + ".ics";
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }));

  // ---------- relative deadlines ----------
  $$("[data-due]").forEach(el => {
    const due = new Date(el.dataset.due); const now = new Date();
    const days = Math.floor((new Date(due.getFullYear(), due.getMonth(), due.getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
    const label = days < 0 ? "closed" : days === 0 ? "due today" : days === 1 ? "due tomorrow" : "due in " + days + " days";
    el.textContent = label + " · " + el.dataset.dueLabel;
    el.classList.toggle("urgent", days <= 1 && days >= 0); el.classList.toggle("soon", days > 1 && days <= 4);
  });
})();
