/* Client-side filtering, URL-synced state, month calendar, and small conveniences. Vanilla JS, no build step. */
(function () {
  "use strict";
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const toolbar = $(".toolbar");
  const list = $("[data-agenda]");
  const cal = $("[data-calendar]");
  const wall = $("[data-flyer-wall]");
  const strip = $("[data-today-strip]");
  const siteKey = $('meta[name="site-key"]');
  const today = (list || cal || document.body).dataset.today || (function (d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); })(new Date());
  const localIso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return localIso(d); };
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };

  // ---------- anonymous usage counts (GoatCounter: no cookies, nothing about who you are) ----------
  // Only the page's path and taps on a few buttons are counted, never event titles or the key after "#".
  // Open any page with #nocount once to stop counting this device (the site owner's own visits).
  const counter = $('meta[name="goatcounter"]');
  const counting = (function () {
    if (!counter || location.protocol !== "https:" || navigator.webdriver) return false;
    if (/[#&]nocount\b/.test(location.hash)) {
      store.set("nocount", "1");
      try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
    }
    return store.get("nocount") !== "1";
  })();
  function count(path, event) {
    if (!counting) return;
    let ref = "";
    try { const r = new URL(document.referrer); if (r.host !== location.host) ref = r.origin + r.pathname; } catch (e) {}
    const url = counter.content + "?" + new URLSearchParams({ p: path, r: ref, e: event ? "true" : "false", s: String(screen.width || ""),
      b: "0", rnd: Math.random().toString(36).slice(2) });
    try { if (navigator.sendBeacon && navigator.sendBeacon(url)) return; } catch (e) {}
    new Image().src = url;
  }
  if (counting) {
    count(location.pathname, false);
    let via = null; try { via = sessionStorage.getItem("unlocked-via"); sessionStorage.removeItem("unlocked-via"); } catch (e) {}
    if (via === "link" || via === "password") count("unlock-" + via, true);
    const standalone = (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone;
    try { if (standalone && !sessionStorage.getItem("counted-home")) { sessionStorage.setItem("counted-home", "1"); count("home-screen", true); } } catch (e) {}
    document.addEventListener("click", e => { const t = e.target.closest && e.target.closest("[data-count]"); if (t) count(t.dataset.count, true); });
  }

  // ---------- the page's events, embedded as JSON (agenda and calendar) ----------
  const DATA = (function () { const el = $("#events-data"); if (!el) return []; try { return JSON.parse(el.textContent) || []; } catch (e) { return []; } })();
  const byId = new Map(DATA.map(e => [String(e.id), e]));

  // ---------- sticky offsets ----------
  // On phones the filter bar scrolls away with the page (see app.css); the day headers then pin right under the top bar.
  function toolbarPinned() { return !!toolbar && getComputedStyle(toolbar).position === "sticky"; }
  function measure() {
    document.documentElement.style.setProperty("--toolbar-h", toolbarPinned() ? toolbar.offsetHeight + "px" : "0px");
  }
  if (toolbar) { measure(); window.addEventListener("resize", measure); }

  // ---------- remembered on this device: followed chats, plans, and "new since your last visit" ----------
  const loadSet = k => { try { return new Set((JSON.parse(store.get(k) || "[]") || []).map(String)); } catch (e) { return new Set(); } };
  let follows = loadSet("my-orgs");
  let plans = loadSet("my-plans");
  const saveFollows = () => store.set("my-orgs", JSON.stringify(Array.from(follows)));
  const savePlans = () => store.set("my-plans", JSON.stringify(Array.from(plans)));
  // A visit ends after 30 quiet minutes; on the next one, anything found after it counts as new.
  let since = Number(store.get("new-since")) || 0;
  (function () {
    const now = Date.now(), seen = Number(store.get("seen-at")) || 0;
    if (seen && now - seen > 30 * 60 * 1000) { since = seen; store.set("new-since", String(since)); }
    store.set("seen-at", String(now));
  })();
  const isNew = d => since > 0 && Number(d.created) > since && d.date >= today;
  const isFresh = d => isNew(d) && String(d.cancelled) !== "1" && String(d.hidden) !== "1";
  const planned = () => DATA.filter(e => plans.has(String(e.id)) && e.date >= today && !Number(e.cancelled));

  // ---------- shared filter state ----------
  const FLAGS = ["food", "req", "rsvp", "virtual", "cancelled", "hidden", "mine", "plans"];
  const state = { q: "", range: (toolbar && toolbar.dataset.defaultRange) || "all", cats: new Set(), food: false, req: false, rsvp: false, virtual: false, cancelled: false, hidden: false, mine: false, plans: false, fresh: false, group: "", month: "", view: "list" };

  function readUrl() {
    const p = new URLSearchParams(location.search);
    state.q = p.get("q") || "";
    if (p.get("range")) state.range = p.get("range");
    state.cats = new Set((p.get("cat") || "").split(",").filter(Boolean));
    for (const k of FLAGS) state[k] = p.get(k) === "1";
    state.group = p.get("group") || "";
    state.month = p.get("m") || "";
    state.view = p.get("view") === "flyers" && wall ? "flyers" : "list";
  }
  function writeUrl() {
    const p = new URLSearchParams();
    if (state.q) p.set("q", state.q);
    if (toolbar && state.range !== (toolbar.dataset.defaultRange || "all")) p.set("range", state.range);
    if (state.cats.size) p.set("cat", Array.from(state.cats).join(","));
    for (const k of FLAGS) if (state[k]) p.set(k, "1");
    if (state.group) p.set("group", state.group);
    if (state.month && state.month !== today.slice(0, 7)) p.set("m", state.month);
    if (state.view === "flyers") p.set("view", "flyers");
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
  const mineOn = () => state.mine && follows.size > 0;
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
    if (ok && mineOn()) ok = follows.has(String(d.group));
    if (ok && state.plans) ok = plans.has(String(d.id));
    if (ok && state.fresh) ok = isFresh(d);
    return ok;
  }
  function freshCount() {
    if (!since) return 0;
    return list ? $$(".event", list).filter(ev => isFresh(ev.dataset)).length : events.filter(isFresh).length;
  }
  function syncControls() {
    if (!toolbar) return;
    $$(".seg button", toolbar).forEach(b => b.setAttribute("aria-pressed", b.dataset.range === state.range));
    $$(".chip[data-cat]", toolbar).forEach(c => c.setAttribute("aria-pressed", state.cats.has(c.dataset.cat)));
    $$(".chip[data-flag]", toolbar).forEach(c => c.setAttribute("aria-pressed", !!state[c.dataset.flag]));
    const mine = $("[data-mine]", toolbar); if (mine) mine.setAttribute("aria-pressed", mineOn());
    const edit = $("[data-mine-edit]", toolbar); if (edit) edit.hidden = !mineOn();
    const nPlans = planned().length;
    const plansChip = $("[data-plans]", toolbar);
    if (plansChip) {
      plansChip.hidden = !nPlans && !state.plans;
      plansChip.setAttribute("aria-pressed", state.plans);
      const c = $("[data-plans-count]", plansChip); if (c) c.textContent = String(nPlans);
    }
    const ics = $("[data-plans-ics]", toolbar); if (ics) ics.hidden = !(state.plans && nPlans);
    const fresh = $("[data-fresh]", toolbar);
    if (fresh) {
      const n = freshCount();
      fresh.hidden = !n && !state.fresh;
      fresh.setAttribute("aria-pressed", state.fresh);
      const c = $("[data-fresh-count]", fresh); if (c) c.textContent = String(n);
    }
    const g = $("select[data-group]", toolbar); if (g) g.value = state.group;
    const s = $("input[data-search]", toolbar); if (s && s.value !== state.q) s.value = state.q;
    const clear = $(".chip.clear", toolbar);
    if (clear) clear.hidden = !(state.q || state.cats.size || state.food || state.req || state.rsvp || state.virtual || state.group || state.cancelled || mineOn() || state.plans || state.fresh);
    $$("[data-view]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.view === state.view)));
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
      if (wall) {
        const flyers = state.view === "flyers";
        list.hidden = flyers; wall.hidden = !flyers;
        if (flyers) renderWall();
      }
    }
    if (cal) shown = renderCalendar();
    const count = $("[data-count]"); if (count) count.textContent = shown === 1 ? "1 event" : shown + " events";
    syncControls(); writeUrl(); measure();
  }

  // ---------- "My orgs": pick the chats you follow ----------
  const picker = $("[data-org-picker]");
  function openPicker() {
    if (!picker) return;
    follows = loadSet("my-orgs");
    $$("input[data-follow-box]", picker).forEach(b => { b.checked = follows.has(b.value); });
    picker.returnValue = "";
    if (typeof picker.showModal === "function") picker.showModal(); else picker.setAttribute("open", "");
  }
  if (picker) {
    picker.addEventListener("close", () => {
      if (picker.returnValue !== "done") return; // Escape or tapping outside: keep things as they were
      follows = new Set($$("input[data-follow-box]:checked", picker).map(b => b.value));
      saveFollows();
      state.mine = follows.size > 0;
      apply();
    });
    const clearAll = $("[data-picker-clear]", picker);
    if (clearAll) clearAll.addEventListener("click", () => $$("input[data-follow-box]", picker).forEach(b => { b.checked = false; }));
    picker.addEventListener("click", e => { if (e.target === picker) picker.close(); }); // a tap on the dimmed backdrop
  }

  if (toolbar) {
    $$(".seg button", toolbar).forEach(b => b.addEventListener("click", () => { state.range = b.dataset.range; apply(); }));
    $$(".chip[data-cat]", toolbar).forEach(c => c.addEventListener("click", () => { state.cats.has(c.dataset.cat) ? state.cats.delete(c.dataset.cat) : state.cats.add(c.dataset.cat); apply(); }));
    $$(".chip[data-flag]", toolbar).forEach(c => c.addEventListener("click", () => { state[c.dataset.flag] = !state[c.dataset.flag]; apply(); }));
    const mineChip = $("[data-mine]", toolbar);
    if (mineChip) mineChip.addEventListener("click", () => { follows = loadSet("my-orgs"); if (!follows.size) { openPicker(); return; } state.mine = !state.mine; apply(); });
    const mineEdit = $("[data-mine-edit]", toolbar);
    if (mineEdit) mineEdit.addEventListener("click", openPicker);
    const plansChip = $("[data-plans]", toolbar);
    if (plansChip) plansChip.addEventListener("click", () => { state.plans = !state.plans; if (state.plans && !cal) state.range = "all"; apply(); });
    const plansIcs = $("[data-plans-ics]", toolbar);
    if (plansIcs) plansIcs.addEventListener("click", () => downloadIcs(planned(), "My BCM plans", "My BCM plans.ics"));
    const freshChip = $("[data-fresh]", toolbar);
    if (freshChip) freshChip.addEventListener("click", () => { state.fresh = !state.fresh; if (state.fresh && !cal) state.range = "all"; apply(); });
    const groupSel = $("select[data-group]", toolbar);
    if (groupSel) groupSel.addEventListener("change", () => { state.group = groupSel.value; apply(); });
    const search = $("input[data-search]", toolbar);
    if (search) {
      let t; search.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { state.q = search.value; apply(); }, 120); });
      search.addEventListener("keydown", e => { if (e.key === "Escape") { search.value = ""; state.q = ""; apply(); search.blur(); } });
      document.addEventListener("keydown", e => { if (e.key === "/" && document.activeElement !== search && !/input|textarea|select/i.test(document.activeElement.tagName)) { e.preventDefault(); search.focus(); } });
    }
    const clearBtn = $(".chip.clear", toolbar);
    if (clearBtn) clearBtn.addEventListener("click", () => { state.q = ""; state.cats.clear(); for (const k of FLAGS) state[k] = false; state.fresh = false; state.group = ""; apply(); });
  }
  $$("[data-view]").forEach(b => b.addEventListener("click", () => { state.view = b.dataset.view === "flyers" ? "flyers" : "list"; apply(); }));

  // ---------- month calendar ----------
  let events = cal ? DATA : [];
  let selectedDay = today;
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  function eventUrl(id) { return (cal.dataset.eventUrl || "/event/{id}").replace("{id}", id); }
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
      `<a class="dl-item ${e.cancelled ? "cancelled" : ""}" href="${eventUrl(e.id)}"><span class="t">${esc(e.time)}</span><span class="body"><span class="title">${esc(e.title)}</span>${e.loc ? `<span class="meta">${esc(e.loc)}</span>` : ""}</span><span class="badges">${plans.has(String(e.id)) ? '<span class="badge going">Going</span>' : ""}${isNew(e) ? '<span class="badge new">New</span>' : ""}${e.req ? '<span class="badge req">Required</span>' : ""}${e.rsvp ? '<span class="badge rsvp">RSVP</span>' : ""}${e.food ? '<span class="badge food">Food</span>' : ""}</span></a>`).join("");
  }
  if (cal) {
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

  // ---------- flyers: the encrypted site stores them sealed; they're decrypted with the key remembered at unlock ----------
  let cryptoKey = null;
  function siteCryptoKey() {
    if (!cryptoKey) cryptoKey = (async () => {
      if (!siteKey || !window.crypto || !crypto.subtle) return null;
      let raw = null; try { raw = sessionStorage.getItem("eventscan-key:" + siteKey.content) || localStorage.getItem("eventscan-key:" + siteKey.content); } catch (e) {}
      if (!raw) return null;
      return crypto.subtle.importKey("raw", Uint8Array.from(atob(raw), c => c.charCodeAt(0)), "AES-GCM", false, ["decrypt"]);
    })();
    return cryptoKey;
  }
  async function decryptImg(img) {
    try {
      const key = await siteCryptoKey(); if (!key) throw new Error("no key");
      const buf = new Uint8Array(await (await fetch(img.dataset.encSrc)).arrayBuffer());
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf.slice(0, 12) }, key, buf.slice(12));
      img.src = URL.createObjectURL(new Blob([plain], { type: "image/jpeg" })); img.classList.remove("enc");
    } catch (e) { img.alt = "Flyer couldn't be unlocked"; }
  }
  const lazy = "IntersectionObserver" in window
    ? new IntersectionObserver(entries => entries.forEach(en => { if (en.isIntersecting) { lazy.unobserve(en.target); decryptImg(en.target); } }), { rootMargin: "400px" })
    : null;
  function loadImages(root) {
    $$("img[data-enc-src]:not([data-queued])", root).forEach(img => { img.dataset.queued = "1"; lazy ? lazy.observe(img) : decryptImg(img); });
  }

  // ---------- flyer wall: the filtered events that have a flyer, as a grid ----------
  const fmtTime = d => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(":00", "");
  const dayShort = e => new Date(e.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) + (Number(e.allday) ? "" : " · " + fmtTime(new Date(e.start)));
  function renderWall() {
    const items = $$(".event", list).filter(ev => !ev.hidden).map(ev => byId.get(ev.dataset.id)).filter(Boolean);
    const withFlyer = items.filter(e => e.thumb);
    const img = e => /\.enc$/.test(e.thumb) ? `data-enc-src="${esc(e.thumb)}" class="enc"` : `src="${esc(e.thumb)}" loading="lazy"`;
    const tiles = withFlyer.map(e => `<a class="fw-tile${Number(e.cancelled) ? " cancelled" : ""}" href="${esc(e.page)}"><span class="fw-img"><img alt="Flyer for ${esc(e.title)}" ${img(e)}></span>`
      + `<span class="fw-cap"><b>${esc(dayShort(e))}</b><span>${esc(e.title)}</span></span></a>`).join("");
    const rest = items.length - withFlyer.length;
    wall.innerHTML = (tiles ? `<div class="fw-grid">${tiles}</div>` : `<div class="empty small">No flyers match these filters.</div>`)
      + (rest ? `<p class="muted small fw-note">${rest} more event${rest === 1 ? " has" : "s have"} no flyer. <button type="button" class="linkish" data-view="list">See the list</button></p>` : "");
    $$("[data-view]", wall).forEach(b => b.addEventListener("click", () => { state.view = "list"; apply(); }));
    loadImages(wall);
  }

  // "New" badges: once you've visited before, they mean new since your last visit (otherwise: found in the last two days).
  if (since) $$(".event[data-created]").forEach(ev => { const b = $("[data-new-badge]", ev); if (b) b.hidden = !isNew(ev.dataset); });

  readUrl();
  if (cal && state.month && state.month !== today.slice(0, 7)) selectedDay = state.month + "-01";
  apply();
  loadImages(document);

  // ---------- Today strip: what's on now and next, free food today, RSVPs closing soon ----------
  function renderToday() {
    if (!strip) return;
    const now = new Date(), t0 = +now, todayIso = localIso(now);
    const st = e => +new Date(e.start), en = e => e.end ? +new Date(e.end) : st(e) + 3600e3;
    const live = DATA.filter(e => !Number(e.cancelled) && !Number(e.hidden));
    const timed = live.filter(e => !Number(e.allday));
    const nowOn = timed.filter(e => st(e) <= t0 && t0 < en(e)).sort((a, b) => st(a) - st(b));
    const next = timed.filter(e => st(e) > t0 && st(e) - t0 < 36 * 3600e3).sort((a, b) => st(a) - st(b));
    const food = live.filter(e => e.date === todayIso && Number(e.food) && (Number(e.allday) || en(e) > t0)).sort((a, b) => st(a) - st(b));
    const due = live.filter(e => e.deadline && +new Date(e.deadline) > t0 && +new Date(e.deadline) - t0 <= 48 * 3600e3).sort((a, b) => a.deadline.localeCompare(b.deadline));
    const when = ms => { const d = new Date(ms), mins = Math.round((ms - t0) / 60000), day = localIso(d);
      return mins < 60 ? "in " + Math.max(mins, 1) + " min" : day === todayIso ? fmtTime(d) : day === localIso(new Date(t0 + 864e5)) ? "tomorrow " + fmtTime(d) : d.toLocaleDateString(undefined, { weekday: "short" }) + " " + fmtTime(d); };
    const tile = (kind, label, title, sub, attrs) => `<${attrs.href ? "a" : "button type=\"button\""} class="tile ${kind}" ${attrs.href ? `href="${esc(attrs.href)}"` : `data-strip="${kind}"`}>`
      + `<span class="tile-k">${esc(label)}</span><span class="tile-t">${esc(title)}</span>${sub ? `<span class="tile-s">${esc(sub)}</span>` : ""}</${attrs.href ? "a" : "button"}>`;
    const tiles = [];
    if (nowOn.length) tiles.push(tile("now", "Happening now", nowOn[0].title, "until " + fmtTime(new Date(en(nowOn[0]))) + (nowOn.length > 1 ? " · " + (nowOn.length - 1) + " more" : ""), { href: nowOn[0].page }));
    const upNext = next.filter(e => !nowOn.includes(e));
    if (upNext.length) tiles.push(tile("next", "Up next · " + when(st(upNext[0])), upNext[0].title, upNext[0].loc, { href: upNext[0].page }));
    if (food.length) tiles.push(tile("food", "🍕 Free food today", food.length === 1 ? food[0].title : food.length + " events",
      food.length === 1 ? (Number(food[0].allday) ? "" : fmtTime(new Date(st(food[0])))) : food.slice(0, 2).map(e => e.title.split(/[:—–-]/)[0].trim()).join(" · "),
      food.length === 1 ? { href: food[0].page } : {}));
    const rsvpLink = $('.nav a[href*="rsvp"]');
    const dueText = ms => { const s = when(ms); return s.startsWith("in ") ? "closes " + s : "by " + s; };
    if (due.length) tiles.push(tile("due", "⏰ RSVP closes soon", due.length === 1 ? due[0].title : due.length + " RSVPs",
      (due.length > 1 ? "First: " + due[0].title.split(/[:—–-]/)[0].trim() + ", " : "") + dueText(+new Date(due[0].deadline)),
      due.length === 1 ? { href: due[0].page } : { href: rsvpLink ? rsvpLink.getAttribute("href") : "" }));
    strip.innerHTML = tiles.join("");
    strip.hidden = !tiles.length;
    const foodBtn = $('[data-strip="food"]', strip);
    if (foodBtn) foodBtn.addEventListener("click", () => {
      state.food = true; state.range = "today"; state.view = "list"; apply();
      const first = $(".event:not([hidden])", list); if (first) first.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }
  if (strip && DATA.length) { renderToday(); setInterval(renderToday, 60000); }

  // ---------- theme toggle ----------
  $$("[data-theme-toggle]").forEach(b => b.addEventListener("click", () => {
    const root = document.documentElement;
    const dark = root.getAttribute("data-theme") === "dark" || (!root.getAttribute("data-theme") && root.classList.contains("system-dark"));
    const next = dark ? "light" : "dark";
    root.setAttribute("data-theme", next);
    store.set("theme", next);
  }));

  // ---------- jump to today ----------
  $$("[data-jump-today]").forEach(b => b.addEventListener("click", () => {
    const target = $(".day.today:not([hidden])") || $$(".day").find(d => !d.hidden && d.nextElementSibling && d.dataset.date >= today);
    if (!target) return;
    const bar = $(".topbar");
    const offset = (bar ? bar.offsetHeight : 56) + (toolbarPinned() ? toolbar.offsetHeight : 0);
    window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - offset - 4, behavior: "smooth" });
  }));

  // ---------- toast ----------
  function toast(msg, ms) {
    let t = $(".toast"); if (!t) { t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.textContent = msg; t.classList.add("show"); clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove("show"), ms || 1800);
  }
  $$("[data-copy-link]").forEach(b => b.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(location.href); toast("Link copied"); } catch (e) { toast("Copy failed"); }
  }));
  $$("[data-copy]").forEach(b => b.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); toast("Link copied"); } catch (e) { toast("Copy failed"); }
  }));

  // ---------- follow a chat from its event page ----------
  $$("[data-follow]").forEach(b => {
    const id = String(b.dataset.follow), name = b.dataset.followName || "this chat", label = $("span", b);
    const render = () => {
      const on = follows.has(id);
      b.setAttribute("aria-pressed", String(on));
      if (label) label.textContent = on ? "Following" : "Follow";
      b.title = on ? "Stop following " + name : "Follow " + name + ": My orgs on the agenda then shows its events";
    };
    b.hidden = false; render();
    b.addEventListener("click", () => {
      follows = loadSet("my-orgs");
      follows.has(id) ? follows.delete(id) : follows.add(id);
      saveFollows(); render();
      if (follows.has(id)) count("follow", true);
      toast(follows.has(id) ? "Following " + name + ". Tap My orgs on the agenda to see just the chats you follow." : "Stopped following " + name, 3500);
    });
  });

  // ---------- "I'm going": your plans, saved on this device ----------
  function renderPlan(btn) {
    const on = plans.has(String(btn.dataset.plan));
    btn.setAttribute("aria-pressed", String(on));
    const label = $("span", btn); if (label) label.textContent = on ? "Going" : "I'm going";
    btn.title = on ? "In My plans (tap to remove)" : "I'm going (saved on this device)";
    const card = btn.closest(".event");
    if (card) { card.classList.toggle("planned", on); const badge = $("[data-plan-badge]", card); if (badge) badge.hidden = !on; }
  }
  $$("[data-plan]").forEach(btn => {
    btn.hidden = false; renderPlan(btn);
    btn.addEventListener("click", () => {
      const id = String(btn.dataset.plan);
      plans = loadSet("my-plans");
      plans.has(id) ? plans.delete(id) : plans.add(id);
      savePlans();
      if (plans.has(id)) count("going", true);
      $$('[data-plan="' + id + '"]').forEach(renderPlan);
      if (toolbar) apply();
      toast(plans.has(id) ? "Added to My plans. Find them all under My plans on the agenda." : "Removed from My plans", plans.has(id) ? 3000 : 1800);
    });
  });

  // ---------- share: on the password-protected site, links carry the key so they open without typing the password ----------
  function savedKey() {
    if (!siteKey) return null;
    let raw = null; try { raw = localStorage.getItem("eventscan-key:" + siteKey.content) || sessionStorage.getItem("eventscan-key:" + siteKey.content); } catch (e) {}
    return raw ? raw.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : null;
  }
  function shareLink(rel) {
    const url = new URL(rel || location.href, location.href); url.hash = "";
    const key = savedKey();
    return url.href + (key ? "#key=" + key : "");
  }
  $$("[data-share]").forEach(b => b.addEventListener("click", async () => {
    const url = b.dataset.shareLink || shareLink(b.dataset.shareUrl);
    const keyed = url.indexOf("#key=") >= 0;
    const data = { title: b.dataset.title || document.title, url };
    count("share", true);
    if (b.dataset.text) data.text = b.dataset.text;
    if (navigator.share) {
      try { await navigator.share(data); return; } catch (e) { if (e && e.name === "AbortError") return; }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast(keyed ? "Link copied. It opens without the password, so share it only with BCM classmates." : "Link copied", keyed ? 4500 : 1800);
    } catch (e) { window.prompt("Copy this link:", url); }
  }));

  // A share link opened in a tab that already shows the site: drop the key from the address bar if it's the one this
  // device remembers; otherwise reload so the unlock step can try it (it falls back to the remembered key).
  if (siteKey) {
    const checkHashKey = () => {
      const m = /[#&]key=([A-Za-z0-9_-]+)/.exec(location.hash); if (!m) return;
      if (m[1] === savedKey()) { try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {} return; }
      location.reload();
    };
    checkHashKey(); window.addEventListener("hashchange", checkHashKey);
  }

  // ---------- freshness: "Updated 2 hours ago", and a warning when the site has gone stale ----------
  $$("[data-generated]").forEach(el => {
    const gen = new Date(el.dataset.generated); if (isNaN(gen)) return;
    const mins = Math.round((Date.now() - gen) / 60000);
    const ago = mins < 2 ? "just now" : mins < 60 ? mins + " min ago" : mins < 1440 ? Math.round(mins / 60) + (Math.round(mins / 60) === 1 ? " hour ago" : " hours ago") : Math.round(mins / 1440) + (Math.round(mins / 1440) === 1 ? " day ago" : " days ago");
    el.textContent = "Updated " + ago; el.title = gen.toLocaleString();
    const stale = $("[data-stale]");
    if (stale && mins > 12 * 60) { $("[data-stale-when]", stale).textContent = gen.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); stale.hidden = false; }
  });

  // ---------- calendar files (.ics): one event from its page, or all of My plans ----------
  function icsDate(iso) { return iso.replace(/[-:]/g, "").slice(0, 15); }
  function icsEsc(s) { return String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n"); }
  function icsEvent(e) {
    const lines = ["BEGIN:VEVENT", "UID:eventscan-" + e.id + "@local", "DTSTAMP:" + icsDate(new Date().toISOString())];
    if (e.allday) {
      const next = new Date(e.start.slice(0, 10) + "T00:00:00"); next.setDate(next.getDate() + 1);
      lines.push("DTSTART;VALUE=DATE:" + e.start.slice(0, 10).replace(/-/g, ""), "DTEND;VALUE=DATE:" + localIso(next).replace(/-/g, ""));
    } else {
      lines.push("DTSTART:" + icsDate(e.start), "DTEND:" + icsDate(e.end || e.start));
    }
    lines.push("SUMMARY:" + icsEsc(e.title));
    if (e.loc) lines.push("LOCATION:" + icsEsc(e.loc));
    if (e.desc) lines.push("DESCRIPTION:" + icsEsc(e.desc));
    if (e.url) lines.push("URL:" + e.url);
    lines.push("END:VEVENT");
    return lines;
  }
  function downloadIcs(items, calName, filename) {
    if (!items.length) return;
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//eventscan//EN"].concat(calName ? ["X-WR-CALNAME:" + icsEsc(calName)] : []);
    for (const e of items) {
      lines.push(...icsEvent({
        id: e.id, title: e.title, start: e.start, end: e.end, allday: e.allday === true || Number(e.allday) === 1, loc: e.loc,
        desc: [e.desc, e.link ? "Details: " + e.link : ""].filter(Boolean).join("\n\n"), url: e.url || e.link || "",
      }));
    }
    lines.push("END:VCALENDAR");
    const blob = new Blob([lines.join("\r\n") + "\r\n"], { type: "text/calendar;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    if (items.length > 1) toast("Downloaded " + items.length + " events. Open the file to add them to your calendar.", 3500);
  }
  $$("[data-ics]").forEach(b => b.addEventListener("click", () => {
    const d = b.dataset;
    downloadIcs([{ id: d.id, title: d.title, start: d.start, end: d.end, allday: d.allday === "1", loc: d.loc, desc: d.desc, url: d.url }],
      null, (d.title || "event").replace(/[^\w\- ]+/g, "").trim().slice(0, 60) + ".ics");
  }));

  // ---------- weather for outdoor events (Houston forecast from Open-Meteo; nothing about the visitor is sent) ----------
  const WX_URL = "https://api.open-meteo.com/v1/forecast?latitude=29.7106&longitude=-95.3963&hourly=temperature_2m,precipitation_probability,weather_code,is_day"
    + "&temperature_unit=fahrenheit&timezone=America%2FChicago&forecast_days=8";
  async function forecast() {
    try { const c = JSON.parse(store.get("wx-houston") || "null"); if (c && Date.now() - c.at < 45 * 60000) return c.data; } catch (e) {}
    const res = await fetch(WX_URL); if (!res.ok) throw new Error(String(res.status));
    const h = (await res.json()).hourly;
    const data = { time: h.time, t: h.temperature_2m, p: h.precipitation_probability, c: h.weather_code, d: h.is_day };
    store.set("wx-houston", JSON.stringify({ at: Date.now(), data }));
    return data;
  }
  function wxIcon(code, day) {
    if (code === 0) return day ? "☀️" : "🌙";
    if (code <= 2) return day ? "🌤️" : "☁️";
    if (code === 3) return "☁️";
    if (code === 45 || code === 48) return "🌫️";
    if (code >= 95) return "⛈️";
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "🌧️";
    if (code >= 71 && code <= 86) return "❄️";
    return "🌡️";
  }
  function wxAt(fc, start, allday) {
    const i = fc.time.indexOf((allday ? start.slice(0, 10) + "T12" : start.slice(0, 13)) + ":00");
    if (i < 0 || fc.t[i] == null) return null;
    return { temp: Math.round(fc.t[i]), rain: fc.p[i] == null ? null : Math.round(fc.p[i] / 10) * 10, icon: wxIcon(fc.c[i], fc.d[i]) };
  }
  (async function () {
    const cards = list ? $$(".event", list).filter(ev => { const e = byId.get(ev.dataset.id); return e && Number(e.outdoor) && !Number(e.cancelled); }) : [];
    const lines = $$("[data-weather]");
    if (!cards.length && !lines.length) return;
    let fc; try { fc = await forecast(); } catch (e) { return; }
    for (const ev of cards) {
      const e = byId.get(ev.dataset.id), w = wxAt(fc, e.start, Number(e.allday)), badges = $(".badges", ev);
      if (!w || !badges) continue;
      const b = document.createElement("span");
      b.className = "badge weather"; b.title = "Houston forecast (Open-Meteo)";
      b.textContent = w.icon + " " + w.temp + "°" + (w.rain >= 20 ? " · " + w.rain + "% rain" : "");
      badges.prepend(b);
    }
    for (const el of lines) {
      const w = wxAt(fc, el.dataset.start, el.dataset.allday === "1"); if (!w) continue;
      el.textContent = "Forecast: " + w.icon + " " + w.temp + "°F" + (w.rain != null ? ", " + w.rain + "% chance of rain" : "") + " · Open-Meteo";
      el.hidden = false;
    }
  })();

  // ---------- "tap any event" tip: shown until dismissed ----------
  $$("[data-tip]").forEach(tip => {
    tip.hidden = store.get("tip-dismissed") === "1";
    const close = $("[data-tip-close]", tip);
    if (close) close.addEventListener("click", () => { tip.hidden = true; store.set("tip-dismissed", "1"); measure(); });
  });

  // ---------- posts to the site owner's private GroupMe chat through a bot (only offered on the password-protected site) ----------
  async function botPost(botId, text) {
    const res = await fetch("https://api.groupme.com/v3/bots/post", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bot_id: botId, text: text.slice(0, 990) }),
    });
    if (!res.ok) throw new Error(String(res.status));
  }
  function sayIn(el, msg, ok) { el.textContent = msg; el.className = "request-status " + (ok ? "ok" : "bad"); el.hidden = false; }

  // "Add your org's chat"
  $$("[data-request-form]").forEach(form => form.addEventListener("submit", async e => {
    e.preventDefault();
    const status = $("[data-request-status]", form), btn = $("button", form);
    const m = /https?:\/\/(?:web\.|app\.)?groupme\.com\/join_group\/\d+\/[A-Za-z0-9_-]+/i.exec(form.link.value);
    if (!m) { sayIn(status, "That doesn't look like a GroupMe share link. It starts with https://groupme.com/join_group/", false); return; }
    const name = form.name.value.trim().slice(0, 80);
    btn.disabled = true;
    try {
      await botPost(form.dataset.bot, "📥 Chat request: " + (name || "(no name)") + " → " + m[0]);
      count("chat-request", true);
      form.reset(); sayIn(status, "Sent, thanks! It'll show up once it's added.", true);
    } catch (err) {
      sayIn(status, "Couldn't send that right now. Please try again in a bit.", false);
    } finally { btn.disabled = false; }
  }));

  // "Report a problem" on an event page. The daily check treats it as a claim to verify against the group chats.
  $$("[data-report-form]").forEach(form => form.addEventListener("submit", async e => {
    e.preventDefault();
    const status = $("[data-report-status]", form), btn = $("button[type=submit]", form);
    const picked = $("input[name=kind]:checked", form);
    if (!picked) { sayIn(status, "Pick what's wrong first.", false); return; }
    const note = form.note.value.replace(/\s+/g, " ").trim().slice(0, 400);
    const d = form.dataset;
    const text = "⚠️ Problem report #" + d.event + " · " + d.title.slice(0, 200) + " (" + d.when + ")\nIssue: " + picked.value + (note ? "\nNote: " + note : "");
    btn.disabled = true;
    try {
      await botPost(d.bot, text);
      count("report", true);
      form.reset(); sayIn(status, "Thanks! It gets checked against the group chats before anything changes.", true);
    } catch (err) {
      sayIn(status, "Couldn't send that right now. Please try again in a bit.", false);
    } finally { btn.disabled = false; }
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
