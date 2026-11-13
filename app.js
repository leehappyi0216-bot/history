(() => {
  "use strict";

  // ---------- indexes ----------
  const LESSONS = [];
  const UNIT_BY_ID = {};
  UNITS.forEach(u => {
    UNIT_BY_ID[u.id] = u;
    u.chapters.forEach(c => c.lessons.forEach(l => {
      l.unit = u; l.chapter = c;
      l.quiz.forEach((q, i) => { q.id = `${l.id}#${i}`; q.lesson = l; });
      l.essays = (typeof ESSAYS !== "undefined" && ESSAYS[l.id]) || [];
      l.essays.forEach((s, i) => { s.id = `${l.id}$${i}`; s.lesson = l; s.total = s.qs.reduce((n, q) => n + q.pts, 0); });
      LESSONS.push(l);
    }));
  });
  const LESSON_BY_ID = Object.fromEntries(LESSONS.map(l => [l.id, l]));
  const QUESTION_BY_ID = Object.fromEntries(LESSONS.flatMap(l => l.quiz.map(q => [q.id, q])));
  const unitLessons = u => LESSONS.filter(l => l.unit === u);
  const unitEssays = u => unitLessons(u).flatMap(l => l.essays);

  // ---------- storage (per-browser, optional) ----------
  const KEY = "history1-v6-progress";
  let state = { done: {}, best: {}, wrong: {}, essay: {}, examBest: {} };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state = Object.assign(state, JSON.parse(raw));
  } catch (e) { /* storage unavailable */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} };

  // ---------- theme ----------
  const root = document.documentElement;
  try { const t = localStorage.getItem("history1-theme"); if (t) root.dataset.theme = t; } catch (e) {}
  const isDark = () => root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  const syncThemeBtn = () => { const b = document.getElementById("themeBtn"); if (b) { b.textContent = isDark() ? "☀️" : "🌙"; b.title = isDark() ? "밝은 화면" : "어두운 화면"; } };

  // ---------- helpers ----------
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const strip = s => String(s).replace(/<[^>]+>/g, "");
  const MARKS = ["①", "②", "③", "④", "⑤"];
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const pct = u => { const ls = unitLessons(u); return Math.round(ls.filter(l => state.done[l.id]).length / ls.length * 100); };
  const norm = s => String(s).toLowerCase().replace(/[\s·.,()'"‘’“”\-~:;!?/]/g, "");
  const lessonLabel = l => `${l.unit.roman}-${l.chapter.no}-${l.no}`;

  const main = $("#main");
  const sidebar = $("#sidebar");

  // ---------- sidebar ----------
  function renderSidebar(activeId) {
    const wrongN = Object.keys(state.wrong).length;
    sidebar.innerHTML = `
      <div class="nav-quick">
        <a href="#notes" class="${activeId === "notes" ? "on" : ""}">📒 오답 노트 <span class="cnt">${wrongN}</span></a>
      </div>` + UNITS.map(u => `
      <div class="nav-unit" data-unit="${u.id}">
        <a class="nav-unit-title" href="#unit-${u.id}"><span class="roman">${u.roman}</span><span>${esc(u.title)}</span></a>
        <div class="nav-progress" title="학습 완료 ${pct(u)}%"><span style="width:${pct(u)}%"></span></div>
        ${u.chapters.map(c => `
          <div class="nav-chapter">${c.no}. ${esc(c.title)}</div>
          ${c.lessons.map(l => `
            <a class="nav-lesson ${l.id === activeId ? "active" : ""}" href="#lesson-${l.id}">
              <span class="no">${l.no}</span><span class="t">${esc(l.title)}</span>
              <span class="chk">${state.done[l.id] ? "✓" : ""}</span><span class="pg">${l.page}</span>
            </a>`).join("")}
        `).join("")}
        <div class="nav-tools">
          <a href="#cards-${u.id}">🃏 용어 카드</a>
          <a href="#quiz-${u.id}">📝 단원 평가</a>
          <a href="#exam-${u.id}">✍️ 서술형 모의고사</a>
        </div>
      </div>`).join("") + `
      <div class="nav-footer">숫자는 교과서 쪽수예요. 진도는 이 브라우저에만 저장돼요.<br><button id="resetBtn">진도 초기화</button></div>`;
    const act = sidebar.querySelector(".nav-lesson.active");
    if (act) act.scrollIntoView({ block: "nearest" });
    else sidebar.scrollTop = 0;
    $("#resetBtn").onclick = () => {
      const b = $("#resetBtn");
      if (!b.dataset.armed) { b.dataset.armed = "1"; b.textContent = "정말 지울까요? 한 번 더 누르면 초기화"; setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = "진도 초기화"; } }, 4000); return; }
      state = { done: {}, best: {}, wrong: {}, essay: {}, examBest: {} }; save(); route();
    };
  }

  // ---------- multiple-choice quiz ----------
  function quizHTML(qs, name) {
    return qs.map((q, i) => `
      <div class="quiz-q card" data-i="${i}">
        <div class="qt"><span class="qn">Q${i + 1}.</span><span>${esc(q.q)}</span></div>
        ${q.src ? `<div class="src">${esc(q.src)}</div>` : ""}
        <div class="opts">${q.o.map((o, j) => `<button class="opt" data-j="${j}"><span class="mk">${MARKS[j]}</span><span>${esc(o)}</span></button>`).join("")}</div>
      </div>`).join("") + `<div id="${name}-score"></div>`;
  }
  function bindQuiz(qs, name, onFinish) {
    let answered = 0, correct = 0;
    main.querySelectorAll(`#${name}-wrap .quiz-q`).forEach(box => {
      const q = qs[+box.dataset.i];
      box.querySelectorAll(".opt").forEach(btn => btn.addEventListener("click", () => {
        const j = +btn.dataset.j;
        const ok = j === q.a;
        box.querySelectorAll(".opt").forEach((b, k) => { b.disabled = true; if (k === q.a) b.classList.add("correct"); });
        if (!ok) btn.classList.add("wrong");
        box.insertAdjacentHTML("beforeend",
          `<div class="exp"><span class="res ${ok ? "ok" : "no"}">${ok ? "정답!" : "오답"}</span>${ok ? "" : `정답은 ${MARKS[q.a]} ${esc(q.o[q.a])}. `}${esc(q.e)}${!ok && name !== "nq" ? ` <span class="note-tag">오답 노트에 저장됨</span>` : ""}</div>`);
        const ref = q.ref || q.id;
        if (ref) { if (ok) delete state.wrong[ref]; else state.wrong[ref] = (state.wrong[ref] || 0) + 1; save(); }
        answered++; if (ok) correct++;
        if (answered === qs.length) {
          const el = document.getElementById(`${name}-score`);
          const msg = correct === qs.length ? "완벽해요! 모두 맞혔어요 🎉" : correct >= qs.length * 0.7 ? "잘했어요! 틀린 문제는 오답 노트에서 다시 풀 수 있어요." : "핵심 정리를 한 번 더 읽고 다시 도전해 봐요.";
          el.innerHTML = `<div class="score-box card"><div class="big">${correct} / ${qs.length}</div><p>${msg}</p><button class="btn primary" id="${name}-retry">다시 풀기</button></div>`;
          document.getElementById(`${name}-retry`).onclick = () => route();
          onFinish && onFinish(correct, qs.length);
        }
        renderSidebarKeep();
      }));
    });
  }
  let currentActive = null;
  const renderSidebarKeep = () => { const y = sidebar.scrollTop; renderSidebar(currentActive); sidebar.scrollTop = y; };

  // ---------- essay (서술형) ----------
  function gradeAnswer(q, text) {
    const t = norm(text);
    const groups = q.keys.map(g => g.some(k => t.includes(norm(k))));
    const need = q.need || q.keys.length;
    const hit = groups.filter(Boolean).length;
    const raw = Math.min(hit, need) / need * q.pts;
    const score = t.length === 0 ? 0 : Math.round(raw * 2) / 2;
    return { groups, score, hit, need };
  }
  function essaySetHTML(set, num, opts = {}) {
    const showLesson = opts.showLesson;
    return `
      <div class="essay card" data-set="${set.id}">
        <div class="essay-head">
          <span class="essay-no">${num}.</span>
          <span class="essay-title">자료를 보고 물음에 답하시오. <b class="pts">[${set.total}점]</b></span>
        </div>
        ${showLesson ? `<div class="essay-from">${lessonLabel(set.lesson)} ${esc(set.lesson.title)} · 교과서 ${set.lesson.page}쪽</div>` : `<div class="essay-from">${esc(set.title)}</div>`}
        <div class="src-box">${set.src.map(s => `<div class="src-item"><span class="tag">${s.tag}</span><div class="src-body">${s.body}</div></div>`).join("")}</div>
        ${set.qs.map((q, i) => `
          <div class="eq" data-q="${i}">
            <div class="eq-q"><span class="eq-n">(${i + 1})</span> ${esc(q.q)} <b class="pts">[${q.pts}점]</b></div>
            <textarea rows="${q.pts >= 3 ? 3 : 2}" placeholder="답안을 써 보세요. (모르면 비워 두고 채점해도 돼요)"></textarea>
            <div class="eq-result" hidden></div>
          </div>`).join("")}
        ${opts.noButton ? "" : `<div class="essay-actions"><button class="btn primary grade-btn">채점하고 모범 답안 보기</button><span class="essay-total"></span></div>`}
      </div>`;
  }
  function gradeSet(box, set) {
    let sum = 0;
    box.querySelectorAll(".eq").forEach(el => {
      const q = set.qs[+el.dataset.q];
      const ta = el.querySelector("textarea");
      const r = gradeAnswer(q, ta.value);
      sum += r.score;
      const res = el.querySelector(".eq-result");
      const full = r.score === q.pts;
      res.hidden = false;
      res.innerHTML = `
        <div class="eq-score ${full ? "ok" : r.score > 0 ? "part" : "no"}">${r.score} / ${q.pts}점</div>
        <div class="kw">채점 키워드: ${q.keys.map((g, i) => `<span class="chip ${r.groups[i] ? "hit" : ""}">${r.groups[i] ? "✓ " : ""}${esc(g[0])}</span>`).join("")}${q.need && q.need < q.keys.length ? ` <span class="need">(${q.need}개 이상)</span>` : ""}</div>
        <div class="model"><span class="lbl">모범 답안</span>${esc(q.ans)}</div>
        ${q.tip ? `<div class="tip"><span class="lbl">채점 기준</span>${esc(q.tip)}</div>` : ""}`;
    });
    state.essay[set.id] = Math.max(state.essay[set.id] || 0, sum);
    save();
    return sum;
  }
  function bindEssays(scope) {
    scope.querySelectorAll(".essay").forEach(box => {
      const set = ESSAY_BY_ID[box.dataset.set];
      const btn = box.querySelector(".grade-btn");
      if (!btn) return;
      btn.onclick = () => {
        const sum = gradeSet(box, set);
        box.querySelector(".essay-total").innerHTML = `예상 점수 <b>${sum} / ${set.total}점</b>`;
        btn.textContent = "다시 채점";
      };
    });
  }
  const ESSAY_BY_ID = Object.fromEntries(LESSONS.flatMap(l => l.essays.map(s => [s.id, s])));

  // ---------- views ----------
  function viewHome() {
    const all = LESSONS.flatMap(l => l.terms.map(t => ({ ...t, l })));
    const pick = all[Math.floor(Date.now() / 86400000) % all.length];
    const next = LESSONS.find(l => !state.done[l.id]);
    const doneN = LESSONS.filter(l => state.done[l.id]).length;
    const wrongN = Object.keys(state.wrong).length;
    const essayIds = Object.keys(state.essay);
    const essayPct = essayIds.length ? Math.round(essayIds.reduce((n, id) => n + state.essay[id] / ESSAY_BY_ID[id].total, 0) / essayIds.length * 100) : null;
    main.className = "main";
    main.innerHTML = `
      <section class="hero">
        <div class="eyebrow">중학교 역사① · 미래엔 (2022 개정)</div>
        <h1>제국주의에서 세계 대전까지,<br>근대 세계를 한눈에</h1>
        <p class="lead">교과서 Ⅴ·Ⅵ 단원 18개 소단원을 핵심 정리 → 용어 카드 → 확인 문제 → <b>기출 형식 서술형</b> 순서로 공부해요.</p>
        <div class="tool-row">
          ${next ? `<a class="btn primary" href="#lesson-${next.id}">${doneN ? "이어서 공부하기" : "처음부터 시작하기"} →</a>` : `<span class="pill">모든 소단원 학습 완료! 🎉</span>`}
          <a class="btn" href="#exam-V">✍️ 서술형 모의고사</a>
        </div>
      </section>
      <div class="stats">
        <div class="stat card"><div class="k">학습 완료</div><div class="v">${doneN}<small> / ${LESSONS.length}</small></div></div>
        <div class="stat card"><div class="k">서술형 평균</div><div class="v">${essayPct == null ? "–" : essayPct + "<small>%</small>"}</div></div>
        <a class="stat card" href="#notes"><div class="k">오답 노트</div><div class="v">${wrongN}<small> 문제</small></div></a>
        <div class="stat card"><div class="k">단원 평가 최고</div><div class="v">${state.best.V ?? "–"}<small> / </small>${state.best.VI ?? "–"}</div></div>
      </div>
      <div class="unit-cards">
        ${UNITS.map(u => `
          <a class="unit-card card" data-unit="${u.id}" href="#unit-${u.id}">
            <span class="big-roman">${u.roman}</span>
            <span class="pill">${u.roman} 단원 · ${unitLessons(u).length}개 소단원 · 서술형 ${unitEssays(u).length}세트</span>
            <h3>${esc(u.title)}</h3>
            <p>${esc(u.desc)}</p>
            <div class="meter"><div class="bar"><span style="width:${pct(u)}%"></span></div>${pct(u)}%</div>
          </a>`).join("")}
      </div>
      <h2><span class="ico">💡</span>오늘의 용어</h2>
      <a class="today card" href="#lesson-${pick.l.id}" style="text-decoration:none">
        <span class="pill">${lessonLabel(pick.l)} ${esc(pick.l.title)}</span>
        <span class="term">${esc(pick.t)}</span>
        <span class="def">${esc(pick.d)}</span>
      </a>
      <h2><span class="ico">🧭</span>이렇게 공부해요</h2>
      <div class="how">
        <div class="card"><div class="step">1. 핵심 정리</div><p>교과서 흐름대로 정리했어요. <b>빈칸 모드</b>로 바꾸면 굵은 글씨가 가려져 암기 확인!</p></div>
        <div class="card"><div class="step">2. 용어 카드</div><p>카드를 눌러 뒤집으며 뜻을 떠올려 보세요.</p></div>
        <div class="card"><div class="step">3. 확인 문제</div><p>바로 채점·해설. 틀린 문제는 <b>오답 노트</b>에 자동 저장돼요.</p></div>
        <div class="card"><div class="step">4. 서술형</div><p>학교 시험과 같은 자료형 서술형. 답을 쓰면 <b>키워드로 채점</b>하고 모범 답안을 보여 줘요.</p></div>
      </div>`;
  }

  function viewUnit(u) {
    main.className = `main u-${u.id}`;
    const best = state.best[u.id];
    main.innerHTML = `
      <div class="eyebrow">${u.roman} 단원</div>
      <h1>${esc(u.title)}</h1>
      <p class="lead">${esc(u.desc)}</p>
      <div class="tool-row">
        <a class="btn primary" href="#lesson-${unitLessons(u)[0].id}">첫 소단원부터 →</a>
        <a class="btn" href="#cards-${u.id}">🃏 용어 카드 ${unitLessons(u).reduce((n, l) => n + l.terms.length, 0)}장</a>
        <a class="btn" href="#quiz-${u.id}">📝 단원 평가${best != null ? ` (최고 ${best}점)` : ""}</a>
        <a class="btn" href="#exam-${u.id}">✍️ 서술형 모의고사${state.examBest[u.id] != null ? ` (최고 ${state.examBest[u.id]}%)` : ""}</a>
      </div>
      <h2><span class="ico">📚</span>차례</h2>
      <div class="chapter-list">
        ${u.chapters.map(c => `
          <div class="card">
            <h3>${c.no}. ${esc(c.title)}</h3>
            ${c.lessons.map(l => `<a class="ll" href="#lesson-${l.id}"><span class="lt">${l.no} ${esc(l.title)} ${state.done[l.id] ? '<span class="ok">✓</span>' : ""}</span><span class="lp">${l.page}쪽</span></a>`).join("")}
          </div>`).join("")}
      </div>
      <h2><span class="ico">⏳</span>단원 연표</h2>
      <div class="card" style="padding:18px 20px">
        <ol class="timeline">${u.timeline.map(t => `<li><span class="y">${t.y}</span><span class="e">${esc(t.e)}</span></li>`).join("")}</ol>
      </div>`;
  }

  function viewLesson(l) {
    const u = l.unit;
    const idx = LESSONS.indexOf(l);
    const prev = LESSONS[idx - 1], next = LESSONS[idx + 1];
    const short = t => esc(t.length > 14 ? t.slice(0, 14) + "…" : t);
    main.className = `main u-${u.id}`;
    main.innerHTML = `
      <div class="lesson-head">
        <div class="meta">
          <span class="pill unit">${u.roman}. ${esc(u.title)}</span>
          <span class="pill">교과서 ${l.page}쪽</span>
        </div>
        <div class="eyebrow" style="margin-top:12px">${l.chapter.no}. ${esc(l.chapter.title)}</div>
        <h1>${l.no} ${esc(l.title)}</h1>
        <p class="lead">${esc(l.intro)}</p>
        <nav class="jump">
          <a href="#sec-points">핵심 정리</a><a href="#sec-terms">용어</a><a href="#sec-quiz">확인 문제</a>${l.essays.length ? `<a href="#sec-essay">서술형</a>` : ""}
        </nav>
      </div>

      <h2 id="sec-points"><span class="ico">📌</span>핵심 정리
        <button class="toggle" id="blankBtn" aria-pressed="false">빈칸 모드</button>
      </h2>
      <div id="points">
      ${l.points.map((p, i) => `
        <div class="point-block card">
          <h3><span class="n">${i + 1}</span>${esc(p.h)}</h3>
          <ul>${p.items.map(it => `<li>${it}</li>`).join("")}</ul>
        </div>`).join("")}
      </div>

      <h2 id="sec-terms"><span class="ico">🃏</span>핵심 용어 <span class="pill">눌러서 뒤집기</span></h2>
      <div class="terms">
        ${l.terms.map(t => `
          <button class="flip" aria-label="${esc(t.t)} 뜻 보기">
            <div class="flip-inner">
              <div class="flip-face flip-front">${esc(t.t)}<small>탭해서 뜻 확인</small></div>
              <div class="flip-face flip-back"><strong>${esc(t.t)}</strong>${esc(t.d)}</div>
            </div>
          </button>`).join("")}
      </div>

      ${l.extra ? `
        <h2><span class="ico">🔎</span>더 알아보기</h2>
        <div class="extra card">
          <div class="type">${esc(l.extra.type)} · 교과서 ${l.extra.page}쪽</div>
          <h3>${esc(l.extra.title)}</h3>
          <p>${l.extra.body}</p>
        </div>` : ""}

      <h2 id="sec-quiz"><span class="ico">✏️</span>확인 문제</h2>
      <div id="lq-wrap">${quizHTML(l.quiz, "lq")}</div>

      ${l.essays.length ? `
        <h2 id="sec-essay"><span class="ico">✍️</span>서술형 연습 <span class="pill">학교 시험 형식</span></h2>
        <p class="hint-left">답안을 쓰고 채점하면 키워드 기준 예상 점수와 모범 답안이 나와요. 실제 채점은 선생님 기준에 따라 달라질 수 있어요.</p>
        <div id="essays">${l.essays.map((s, i) => essaySetHTML(s, i + 1)).join("")}</div>` : ""}

      <div class="lesson-actions">
        <div class="grp">
          ${prev ? `<a class="btn" href="#lesson-${prev.id}">← ${prev.no} ${short(prev.title)}</a>` : `<a class="btn" href="#unit-${u.id}">← 단원 처음</a>`}
        </div>
        <div class="grp">
          <button class="btn ${state.done[l.id] ? "done" : ""}" id="doneBtn">${state.done[l.id] ? "✓ 학습 완료" : "학습 완료 표시"}</button>
          ${next ? `<a class="btn primary" href="#lesson-${next.id}">다음: ${next.no} ${short(next.title)} →</a>` : `<a class="btn primary" href="#exam-${u.id}">서술형 모의고사 →</a>`}
        </div>
      </div>`;

    bindFlips();
    bindQuiz(l.quiz, "lq", (c, n) => { if (c === n && !state.done[l.id]) { state.done[l.id] = true; save(); renderSidebarKeep(); syncDoneBtn(l); } });
    bindEssays(main);
    $("#doneBtn").onclick = () => { state.done[l.id] = !state.done[l.id]; save(); renderSidebarKeep(); syncDoneBtn(l); };
    const pts = $("#points"), bb = $("#blankBtn");
    bb.onclick = () => {
      const on = pts.classList.toggle("blank-mode");
      bb.setAttribute("aria-pressed", on); bb.textContent = on ? "빈칸 모드 켜짐" : "빈칸 모드";
      pts.querySelectorAll("b.show").forEach(b => b.classList.remove("show"));
    };
    pts.addEventListener("click", e => { const b = e.target.closest("b"); if (b && pts.classList.contains("blank-mode")) b.classList.toggle("show"); });
    main.querySelectorAll(".jump a").forEach(a => a.addEventListener("click", e => { e.preventDefault(); document.querySelector(a.getAttribute("href")).scrollIntoView({ behavior: "smooth" }); }));
  }
  function syncDoneBtn(l) {
    const b = $("#doneBtn"); if (!b) return;
    b.classList.toggle("done", !!state.done[l.id]);
    b.textContent = state.done[l.id] ? "✓ 학습 완료" : "학습 완료 표시";
  }
  function bindFlips() {
    main.querySelectorAll(".flip:not(.fc)").forEach(f => f.addEventListener("click", () => f.classList.toggle("on")));
  }

  const shuffleOptions = q => {
    const order = shuffle(q.o.map((_, i) => i));
    return { ...q, ref: q.id, o: order.map(i => q.o[i]), a: order.indexOf(q.a) };
  };

  function viewQuiz(u) {
    main.className = `main u-${u.id}`;
    const pool = unitLessons(u).flatMap(l => l.quiz.map(q => ({ ...q, src: `${lessonLabel(l)} ${l.title}` })));
    const qs = shuffle(pool).slice(0, 10).map(shuffleOptions);
    const best = state.best[u.id];
    main.innerHTML = `
      <div class="eyebrow">${u.roman} 단원 평가</div>
      <h1>${esc(u.title)}</h1>
      <p class="lead">단원 전체 ${pool.length}문제 중 무작위 10문제예요. 보기 순서도 매번 바뀌어요.${best != null ? ` 지금까지 최고 점수: <b>${best}점</b>` : ""}</p>
      <h2><span class="ico">📝</span>문제</h2>
      <div id="uq-wrap">${quizHTML(qs, "uq")}</div>`;
    bindQuiz(qs, "uq", (c, n) => {
      const score = Math.round(c / n * 100);
      if (state.best[u.id] == null || score > state.best[u.id]) { state.best[u.id] = score; save(); }
    });
  }

  function viewNotes() {
    main.className = "main";
    const ids = Object.keys(state.wrong).filter(id => QUESTION_BY_ID[id]);
    const qs = ids.map(id => ({ ...shuffleOptions(QUESTION_BY_ID[id]), src: `${lessonLabel(QUESTION_BY_ID[id].lesson)} ${QUESTION_BY_ID[id].lesson.title} · 틀린 횟수 ${state.wrong[id]}회` }));
    main.innerHTML = `
      <div class="eyebrow">복습</div>
      <h1>📒 오답 노트</h1>
      <p class="lead">${qs.length ? `틀린 문제 ${qs.length}개를 다시 풀어 봐요. 맞히면 오답 노트에서 빠져요.` : "아직 틀린 문제가 없어요. 확인 문제와 단원 평가를 풀면 틀린 문제가 여기에 모여요."}</p>
      ${qs.length ? `<div id="nq-wrap">${quizHTML(qs, "nq")}</div>` : `<div class="tool-row"><a class="btn primary" href="#quiz-V">Ⅴ 단원 평가</a><a class="btn primary" href="#quiz-VI">Ⅵ 단원 평가</a></div>`}`;
    if (qs.length) bindQuiz(qs, "nq");
  }

  let examTimer = null;
  function viewExam(u) {
    main.className = `main u-${u.id} exam-page`;
    const sets = shuffle(unitEssays(u)).slice(0, 6).sort((a, b) => LESSONS.indexOf(a.lesson) - LESSONS.indexOf(b.lesson));
    const total = sets.reduce((n, s) => n + s.total, 0);
    main.innerHTML = `
      <div class="exam-paper card">
        <div class="paper-head">
          <div class="ph-title">${u.roman} 단원 서술형 모의고사</div>
          <div class="ph-sub">중학교 역사① · ${esc(u.title)}</div>
        </div>
        <div class="paper-rules">
          <div>· 문제는 서답형으로 총 ( ${sets.length} )문항, 총 ${total}점입니다.</div>
          <div>· 단원 서술형 ${unitEssays(u).length}세트 중 무작위로 출제됩니다. 새로고침하면 바뀌어요.</div>
          <div>· 제한 시간 ${sets.length * 7}분. 다 쓴 뒤 [답안 제출]을 누르면 채점돼요.</div>
        </div>
        <div class="exam-bar">
          <button class="btn primary" id="timerBtn">⏱ 시간 재기 시작</button>
          <span class="timer" id="timer">${String(sets.length * 7).padStart(2, "0")}:00</span>        </div>
      </div>
      <div class="exam-grid">${sets.map((s, i) => essaySetHTML(s, i + 1, { showLesson: true, noButton: true })).join("")}</div>
      <div class="exam-submit">
        <button class="btn primary big-btn" id="submitBtn">답안 제출하고 채점하기</button>
      </div>
      <div id="examResult"></div>`;

    let left = sets.length * 7 * 60;
    clearInterval(examTimer);
    const tEl = $("#timer");
    const paint = () => { tEl.textContent = `${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`; tEl.classList.toggle("warn", left <= 300); };
    $("#timerBtn").onclick = () => {
      if (examTimer) { clearInterval(examTimer); examTimer = null; $("#timerBtn").textContent = "⏱ 계속"; return; }
      $("#timerBtn").textContent = "⏸ 일시 정지";
      examTimer = setInterval(() => { left--; paint(); if (left <= 0) { clearInterval(examTimer); examTimer = null; tEl.textContent = "시간 종료"; } }, 1000);
    };
    $("#submitBtn").onclick = () => {
      clearInterval(examTimer); examTimer = null;
      let sum = 0;
      const rows = sets.map((s, i) => {
        const box = main.querySelector(`.essay[data-set="${CSS.escape(s.id)}"]`);
        const got = gradeSet(box, s);
        sum += got;
        return `<tr><td>${i + 1}</td><td><a href="#lesson-${s.lesson.id}">${lessonLabel(s.lesson)} ${esc(s.lesson.title)}</a></td><td class="num">${got} / ${s.total}</td></tr>`;
      });
      const p = Math.round(sum / total * 100);
      if (state.examBest[u.id] == null || p > state.examBest[u.id]) { state.examBest[u.id] = p; save(); }
      $("#examResult").innerHTML = `
        <div class="score-box card">
          <div class="big">${sum} / ${total}</div>
          <p>${p >= 90 ? "실전도 자신 있어요! 🎉" : p >= 70 ? "좋아요. 놓친 키워드를 모범 답안으로 확인하세요." : "모범 답안의 핵심 용어를 외운 뒤 다시 도전해 봐요."} (키워드 기준 예상 점수)</p>
          <table class="result-tbl"><tr><th>번호</th><th>출제 범위</th><th>점수</th></tr>${rows.join("")}</table>
          <div class="tool-row" style="justify-content:center"><button class="btn primary" id="examRetry">새 시험지 받기</button></div>
        </div>`;
      $("#examRetry").onclick = () => route();
      $("#submitBtn").disabled = true;
      $("#examResult").scrollIntoView({ behavior: "smooth" });
    };
  }

  function viewCards(u) {
    main.className = `main u-${u.id}`;
    let cards = unitLessons(u).flatMap(l => l.terms.map(t => ({ ...t, l })));
    let i = 0;
    main.innerHTML = `
      <div class="eyebrow">${u.roman} 단원 용어 카드</div>
      <h1>${esc(u.title)}</h1>
      <p class="lead">카드를 눌러 뒤집고, 화살표로 넘겨요. (키보드: ← → 이동)</p>
      <div class="fc-wrap">
        <button class="flip fc" id="fc"><div class="flip-inner">
          <div class="flip-face flip-front"><span id="fcT"></span><small id="fcSrc"></small></div>
          <div class="flip-face flip-back" id="fcD"></div>
        </div></button>
        <div class="fc-ctrl">
          <button class="btn" id="fcPrev">← 이전</button>
          <span class="fc-count" id="fcN"></span>
          <button class="btn primary" id="fcNext">다음 →</button>
        </div>
        <div class="fc-ctrl"><button class="btn" id="fcShuf">🔀 섞기</button></div>
      </div>`;
    const fc = $("#fc");
    const show = () => {
      const c = cards[i];
      fc.classList.remove("on");
      $("#fcT").textContent = c.t;
      $("#fcSrc").textContent = `${c.l.chapter.no}-${c.l.no} ${c.l.title}`;
      $("#fcD").innerHTML = `<strong>${esc(c.t)}</strong>${esc(c.d)}`;
      $("#fcN").textContent = `${i + 1} / ${cards.length}`;
    };
    fc.onclick = () => fc.classList.toggle("on");
    $("#fcPrev").onclick = () => { i = (i - 1 + cards.length) % cards.length; show(); };
    $("#fcNext").onclick = () => { i = (i + 1) % cards.length; show(); };
    $("#fcShuf").onclick = () => { cards = shuffle(cards); i = 0; show(); };
    show();
  }

  document.addEventListener("keydown", e => {
    if (!$("#fc") || /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.key === "ArrowRight") $("#fcNext").click();
    else if (e.key === "ArrowLeft") $("#fcPrev").click();
  });

  // ---------- search ----------
  const searchInput = $("#search"), results = $("#searchResults");
  const INDEX = LESSONS.flatMap(l => [
    ...l.terms.map(t => ({ t: t.t, d: t.d, l })),
    { t: l.title, d: l.intro, l }
  ]);
  searchInput.addEventListener("input", () => {
    const q = searchInput.value.trim();
    if (!q) { results.hidden = true; return; }
    const hits = INDEX.filter(x => x.t.includes(q) || x.d.includes(q)).slice(0, 12);
    const ptHits = LESSONS.filter(l => !hits.some(h => h.l === l) && l.points.some(p => p.items.some(it => strip(it).includes(q))))
      .slice(0, 6).map(l => ({ t: l.title, d: strip(l.points.flatMap(p => p.items).find(it => strip(it).includes(q))), l }));
    const all = hits.concat(ptHits);
    results.innerHTML = all.length ? all.map(x => `
      <a href="#lesson-${x.l.id}">
        <div class="sr-term">${esc(x.t)}</div>
        <div class="sr-where">${lessonLabel(x.l)} ${esc(x.l.title)} · ${x.l.page}쪽</div>
        <div class="sr-def">${esc(x.d)}</div>
      </a>`).join("") : `<div class="empty">‘${esc(q)}’에 대한 결과가 없어요.</div>`;
    results.hidden = false;
  });
  results.addEventListener("click", () => { results.hidden = true; searchInput.value = ""; });
  document.addEventListener("click", e => { if (!e.target.closest(".search")) results.hidden = true; });
  searchInput.addEventListener("keydown", e => {
    if (e.key === "Escape") { results.hidden = true; searchInput.blur(); }
    if (e.key === "Enter") { const a = results.querySelector("a"); if (a) { location.hash = a.getAttribute("href"); results.hidden = true; searchInput.value = ""; } }
  });

  // ---------- topbar buttons ----------
  const scrim = $("#scrim");
  const closeMenu = () => { sidebar.classList.remove("open"); scrim.hidden = true; };
  $("#menuBtn").onclick = () => { const o = sidebar.classList.toggle("open"); scrim.hidden = !o; };
  scrim.onclick = closeMenu;
  $("#themeBtn").onclick = () => {
    root.dataset.theme = isDark() ? "light" : "dark";
    try { localStorage.setItem("history1-theme", root.dataset.theme); } catch (e) {}
    syncThemeBtn();
  };
  syncThemeBtn();

  // ---------- router ----------
  function route() {
    clearInterval(examTimer); examTimer = null;
    const m = (location.hash || "").slice(1).match(/^(lesson|unit|quiz|exam|cards|notes)(?:-(.+))?$/);
    const kind = m ? m[1] : "home", id = m ? m[2] : undefined;
    let activeId = null;
    const U = UNIT_BY_ID[id];
    if (kind === "lesson" && LESSON_BY_ID[id]) { activeId = id; viewLesson(LESSON_BY_ID[id]); document.title = `${LESSON_BY_ID[id].title} | 역사①`; }
    else if (kind === "unit" && U) { viewUnit(U); document.title = `${U.roman}. ${U.title} | 역사①`; }
    else if (kind === "quiz" && U) { viewQuiz(U); document.title = `${U.roman} 단원 평가 | 역사①`; }
    else if (kind === "exam" && U) { viewExam(U); document.title = `${U.roman} 서술형 모의고사 | 역사①`; }
    else if (kind === "cards" && U) { viewCards(U); document.title = `${U.roman} 용어 카드 | 역사①`; }
    else if (kind === "notes") { activeId = "notes"; viewNotes(); document.title = "오답 노트 | 역사①"; }
    else { viewHome(); document.title = "역사① Ⅴ·Ⅵ 단원 학습"; }
    currentActive = activeId;
    renderSidebar(activeId);
    closeMenu();
    window.scrollTo(0, 0);
    main.focus({ preventScroll: true });
  }
  window.addEventListener("hashchange", route);
  route();
})();
