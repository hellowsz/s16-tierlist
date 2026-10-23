(() => {
  "use strict";

  const STORAGE_KEY = "s16-tierlist-v1";
  const TIERS = [
    { id: "t1", label: "夯", color: "var(--t1)" },
    { id: "t2", label: "顶级", color: "var(--t2)" },
    { id: "t3", label: "人上人", color: "var(--t3)" },
    { id: "t4", label: "NPC", color: "var(--t4)" },
    { id: "t5", label: "拉完了", color: "var(--t5)" },
  ];
  const REGIONS = ["LCK", "LPL", "LEC", "LCS", "LCP", "CBLOL"];
  const ROLE_CN = { top: "上", jungle: "野", mid: "中", bot: "下", support: "辅" };
  const CLICK_AFTER_DRAG_MS = 250;
  const BOX_H = 4 / 3; // 照片框 3:4
  const FACE_TARGET = 0.3; // 人脸占框高比例
  const FOCUS_Y = 0.56; // 人脸下沿焦点在框内的高度位置
  const MAX_ZOOM = 3.5;

  const players = Array.isArray(window.PLAYERS) ? window.PLAYERS : [];
  const byId = new Map(players.map((p) => [p.id, p]));

  const emptyState = () => ({
    tiers: Object.fromEntries(TIERS.map((t) => [t.id, []])),
    labels: Object.fromEntries(TIERS.map((t) => [t.id, t.label])),
    photo: {},
  });

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyState();
      const saved = JSON.parse(raw);
      const base = emptyState();
      const tiers = Object.fromEntries(
        TIERS.map((t) => [t.id, (saved.tiers?.[t.id] || []).filter((id) => byId.has(id))])
      );
      return {
        tiers,
        labels: { ...base.labels, ...(saved.labels || {}) },
        photo: { ...(saved.photo || {}) },
      };
    } catch (err) {
      console.warn("读取本地排名失败，已从空白开始", err);
      return emptyState();
    }
  }

  let state = loadState();
  let lastDragEnd = 0;
  let isDragging = false;

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.warn("保存排名失败（可能是隐私模式）", err);
    }
  }

  // 从 DOM 读出当前排位，生成新的 state（不原地改）
  function snapshotFromDom() {
    const tiers = Object.fromEntries(
      TIERS.map((t) => [
        t.id,
        [...document.querySelectorAll(`.cards[data-tier="${t.id}"] .card`)].map((c) => c.dataset.id),
      ])
    );
    return { ...state, tiers };
  }

  function stampSize(text) {
    const len = [...text].length;
    if (len <= 1) return "64px";
    if (len === 2) return "44px";
    if (len === 3) return "34px";
    return "26px";
  }

  function renderBoard() {
    const board = document.getElementById("board");
    board.replaceChildren(
      ...TIERS.map((t) => {
        const row = document.createElement("div");
        row.className = "tier";
        row.dataset.tier = t.id;
        row.style.setProperty("--tier-color", t.color);

        const label = document.createElement("div");
        label.className = "tier-label";
        const stamp = document.createElement("span");
        stamp.className = "stamp";
        stamp.contentEditable = "plaintext-only";
        stamp.spellcheck = false;
        stamp.title = "点击可改档位名";
        stamp.textContent = state.labels[t.id];
        stamp.style.setProperty("--stamp-size", stampSize(stamp.textContent));
        stamp.addEventListener("input", () => {
          stamp.style.setProperty("--stamp-size", stampSize(stamp.textContent));
        });
        stamp.addEventListener("blur", () => {
          const text = stamp.textContent.trim().slice(0, 6) || t.label;
          stamp.textContent = text;
          stamp.style.setProperty("--stamp-size", stampSize(text));
          state = { ...state, labels: { ...state.labels, [t.id]: text } };
          saveState();
        });
        stamp.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            stamp.blur();
          }
        });
        label.append(stamp);

        const cards = document.createElement("div");
        cards.className = "cards";
        cards.dataset.tier = t.id;
        cards.append(...state.tiers[t.id].map((id) => renderCard(byId.get(id))));

        row.append(label, cards);
        return row;
      })
    );
  }

  function renderPool() {
    const placed = new Set(Object.values(state.tiers).flat());
    const pool = document.getElementById("pool");
    pool.replaceChildren(...players.filter((p) => !placed.has(p.id)).map(renderCard));
    applyFilter();
  }

  /**
   * 按人脸焦点裁切：卡片照片框宽 1、高 BOX_H，先 cover 铺满，
   * 再放大到人脸约占框高 FACE_TARGET，焦点放在框的水平中线、FOCUS_Y 高度处，最后夹紧不露边。
   * 用绝对定位而非 object-fit，html2canvas 导出时才能裁得一致。
   */
  function cropStyle(img) {
    const ar = img.ar || 1;
    const { x, y, fh } = img.crop || { x: 0.5, y: 0.35, fh: 0 };
    const cover = Math.max(1 / ar, BOX_H);
    const wanted = fh > 0 ? (FACE_TARGET * BOX_H) / fh : cover;
    const k = Math.min(Math.max(cover, wanted), cover * MAX_ZOOM);
    const w = ar * k;
    const h = k;
    const clamp = (v, min) => Math.min(0, Math.max(min, v));
    const left = clamp(0.5 - x * w, 1 - w);
    const top = clamp(FOCUS_Y * BOX_H - y * h, BOX_H - h);
    const pct = (v, base) => `${((v / base) * 100).toFixed(2)}%`;
    return { width: pct(w, 1), height: pct(h, BOX_H), left: pct(left, 1), top: pct(top, BOX_H) };
  }

  function renderCard(p) {
    const card = document.createElement("div");
    card.className = "card";
    card.dataset.id = p.id;
    card.dataset.team = p.team;
    card.dataset.region = p.region;
    card.tabIndex = 0;

    const idx = (state.photo[p.id] || 0) % Math.max(p.imgs.length, 1);
    const img = p.imgs[idx];

    const photo = document.createElement("div");
    photo.className = "photo";
    if (img) {
      const el = document.createElement("img");
      el.alt = `${p.name}（${p.teamName}）`;
      el.draggable = false;
      el.loading = "lazy";
      el.src = img.src;
      Object.assign(el.style, cropStyle(img));
      photo.append(el);
    }

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = p.name;

    const team = document.createElement("span");
    team.className = "team";
    team.textContent = `${p.team}  ${ROLE_CN[p.role] || ""}`;

    card.append(photo, name, team);

    if (img && !img.official) {
      const old = document.createElement("span");
      old.className = "old";
      old.textContent = "旧照";
      old.title = "本届 S 赛官方相册暂无单人照，使用 2026 赛季官方头像";
      card.append(old);
    }

    if (p.imgs.length > 1) {
      const dots = document.createElement("span");
      dots.className = "dots";
      dots.setAttribute("aria-hidden", "true");
      p.imgs.forEach((_, i) => {
        const d = document.createElement("i");
        if (i === idx) d.className = "on";
        dots.append(d);
      });
      card.append(dots);
      card.title = "点照片换一张";
    }
    return card;
  }

  function cyclePhoto(card) {
    const p = byId.get(card.dataset.id);
    if (!p || p.imgs.length < 2) return;
    const next = ((state.photo[p.id] || 0) + 1) % p.imgs.length;
    state = { ...state, photo: { ...state.photo, [p.id]: next } };
    saveState();
    card.replaceWith(renderCard(p));
    document.querySelector(`.card[data-id="${CSS.escape(p.id)}"]`)?.focus();
  }

  // 筛选只作用于待排区
  let filter = { kind: "all", value: null };

  function renderFilters() {
    const wrap = document.getElementById("filters");
    const teams = [...new Map(players.map((p) => [p.team, p])).values()];
    const make = (text, kind, value, extraClass) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `chip ${extraClass || ""}`.trim();
      b.textContent = text;
      b.setAttribute("aria-pressed", String(filter.kind === kind && filter.value === value));
      b.addEventListener("click", () => {
        filter = { kind, value };
        renderFilters();
        applyFilter();
      });
      return b;
    };
    const sep = document.createElement("span");
    sep.className = "chip-sep";
    wrap.replaceChildren(
      make("全部", "all", null, "region"),
      ...REGIONS.map((r) => make(r, "region", r, "region")),
      sep,
      ...teams.map((p) => make(p.team, "team", p.team))
    );
  }

  function applyFilter() {
    const cards = document.querySelectorAll("#pool .card");
    cards.forEach((c) => {
      const visible =
        filter.kind === "all" ||
        (filter.kind === "region" && c.dataset.region === filter.value) ||
        (filter.kind === "team" && c.dataset.team === filter.value);
      c.classList.toggle("is-hidden", !visible);
    });
    document.getElementById("pool-count").textContent = `${cards.length} 人`;
  }

  function setupSortable() {
    if (typeof Sortable === "undefined") {
      alert("拖拽组件加载失败，请检查网络后刷新页面");
      return;
    }
    document.querySelectorAll(".cards").forEach((el) => {
      Sortable.create(el, {
        group: "players",
        animation: 140,
        delay: 120,
        delayOnTouchOnly: true,
        forceFallback: true,
        fallbackOnBody: true,
        filter: ".is-hidden",
        // 单纯点击也会触发 onEnd，只有真正拖起来过才屏蔽随后的点击
        onStart: () => {
          isDragging = true;
        },
        onEnd: () => {
          if (isDragging) lastDragEnd = Date.now();
          isDragging = false;
          state = snapshotFromDom();
          saveState();
          applyFilter();
        },
      });
    });
  }

  function setupEvents() {
    document.addEventListener("click", (e) => {
      const photo = e.target.closest(".card .photo");
      if (!photo || Date.now() - lastDragEnd < CLICK_AFTER_DRAG_MS) return;
      cyclePhoto(photo.closest(".card"));
    });
    document.addEventListener("keydown", (e) => {
      const card = e.target.closest?.(".card");
      if (card && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        cyclePhoto(card);
      }
    });

    document.getElementById("btn-reset").addEventListener("click", () => {
      if (!confirm("把所有选手放回待排区？档位名和照片选择会保留。")) return;
      state = { ...state, tiers: emptyState().tiers };
      saveState();
      renderAll();
    });

    document.getElementById("btn-export").addEventListener("click", exportImage);
  }

  async function exportImage() {
    if (typeof html2canvas === "undefined") {
      alert("截图组件加载失败，请检查网络后刷新页面");
      return;
    }
    const board = document.getElementById("board");
    const btn = document.getElementById("btn-export");
    btn.disabled = true;
    btn.textContent = "生成中…";
    document.body.classList.add("exporting");
    try {
      const canvas = await html2canvas(board, {
        backgroundColor: getComputedStyle(document.body).backgroundColor,
        scale: 2,
        useCORS: true,
      });
      const a = document.createElement("a");
      a.download = "S16-夯到拉.png";
      a.href = canvas.toDataURL("image/png");
      a.click();
    } catch (err) {
      console.error("导出图片失败", err);
      alert("导出图片失败：请用本地服务器打开页面（不要直接双击 html 文件）");
    } finally {
      document.body.classList.remove("exporting");
      btn.disabled = false;
      btn.textContent = "保存为图片";
    }
  }

  function renderAll() {
    renderBoard();
    renderPool();
    setupSortable();
  }

  if (players.length === 0) {
    document.getElementById("pool").textContent = "选手数据没加载到：确认 data.js 和页面在同一目录。";
    return;
  }
  renderFilters();
  setupEvents();
  renderAll();
})();
