(function () {
  var state = null;
  var selectedDay = null;
  var todoFilter = "all";
  var todoFormOpen = false;
  var goalEditing = false;
  var toastTimer = null;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function clear(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  }

  function toast(message) {
    var box = document.getElementById("toast");
    box.textContent = message;
    box.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      box.classList.remove("is-on");
    }, 3200);
  }

  function api(path, options) {
    options = options || {};
    return fetch(path, {
      method: options.method || "GET",
      headers: options.body ? { "Content-Type": "application/json" } : undefined,
      body: options.body || undefined,
    }).then(function (res) {
      if (res.status === 401) {
        window.location.href = "/login";
        throw new Error("需要口令");
      }
      if (res.status === 204) return null;
      return res.json().then(function (body) {
        if (!res.ok) {
          var detail = body && body.detail;
          if (Array.isArray(detail)) detail = "有一项没填对";
          throw new Error(detail || "没能保存");
        }
        return body;
      });
    });
  }

  function send(path, method, body) {
    return api(path, { method: method, body: body ? JSON.stringify(body) : undefined })
      .then(function (next) {
        state = next;
        render();
        return true;
      })
      .catch(function (err) {
        if (err.message !== "需要口令") toast(err.message || "没能保存");
        return false;
      });
  }

  function show(view) {
    var known = { today: 1, todos: 1, sparks: 1, schedule: 1, daily: 1, weekly: 1, settings: 1 };
    if (!known[view]) view = "today";
    document.querySelectorAll("[data-screen]").forEach(function (screen) {
      var on = screen.getAttribute("data-screen") === view;
      screen.classList.toggle("is-on", on);
      screen.hidden = !on;
    });
    document.querySelectorAll("[data-go]").forEach(function (btn) {
      var target = btn.getAttribute("data-go");
      var match = target === view || (view === "weekly" && target === "daily");
      if (match) btn.setAttribute("aria-current", "page");
      else btn.removeAttribute("aria-current");
    });
    if (location.hash !== "#" + view) history.replaceState(null, "", "#" + view);
  }

  function kept(id) {
    var node = document.getElementById(id);
    return node && node.dataset.dirty === "1";
  }

  function addDays(iso, count) {
    var parts = iso.split("-");
    var day = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
    day.setUTCDate(day.getUTCDate() + count);
    return day.toISOString().slice(0, 10);
  }

  function findSpark(id) {
    var lists = [state.inbox, state.holds, state.writing, state.practices, state.daily.aged, state.weekly.aged];
    for (var i = 0; i < lists.length; i += 1) {
      var found = (lists[i] || []).filter(function (item) { return String(item.id) === String(id); })[0];
      if (found) return found;
    }
    return null;
  }

  function metaLine(parts, flags) {
    var p = el("p", "meta", (parts || []).filter(Boolean).join(" · "));
    (flags || []).forEach(function (flag) {
      p.appendChild(document.createTextNode(" "));
      var span = el("span", "flag" + (flag.tone ? " flag-" + flag.tone : ""), flag.text);
      p.appendChild(span);
    });
    return p;
  }

  function actionButtons(todo) {
    var row = el("div", "row-actions");
    (todo.actions || []).forEach(function (action) {
      if (action === "done") row.appendChild(button("btn btn-quiet", "完成", { "data-done": todo.id }));
      if (action === "postpone") row.appendChild(button("btn btn-quiet", "放到明天", { "data-postpone": todo.id }));
      if (action === "drop") row.appendChild(button("btn btn-danger", "删掉", { "data-drop": todo.id }));
      if (action === "wait") row.appendChild(button("btn btn-quiet", "再等等", { "data-wait": "1" }));
    });
    return row;
  }

  function button(className, text, attrs) {
    var node = el("button", className, text);
    node.type = "button";
    Object.keys(attrs || {}).forEach(function (key) {
      node.setAttribute(key, attrs[key]);
    });
    return node;
  }

  function taskCard(todo, mark) {
    var card = el("article", "card task");
    card.appendChild(el("div", "task-no", mark));
    var body = el("div");
    body.appendChild(el("h3", null, todo.title));
    body.appendChild(metaLine(todo.meta, todo.flags));
    card.appendChild(body);
    var actions = actionButtons(todo);
    actions.className = "task-actions";
    card.appendChild(actions);
    return card;
  }

  function sparkActions(id) {
    var row = el("div", "spark-actions");
    [["todo", "转待办"], ["write", "写成文章"], ["try", "做一次"], ["hold", "先放着"]].forEach(function (pair) {
      row.appendChild(button("btn btn-quiet", pair[1], { "data-act": pair[0], "data-spark": id }));
    });
    return row;
  }

  function sparkCard(spark, withActions) {
    var card = el("li", "card entry spark" + (spark.aged ? " aged" : ""));
    card.appendChild(el("p", null, spark.text));
    card.appendChild(el("p", "meta", spark.meta));
    if (withActions) card.appendChild(sparkActions(spark.id));
    return card;
  }

  function emptyNote(text) {
    return el("p", "hint", text);
  }

  function fillSelect(select, options, placeholder, preferFirst) {
    if (!select || document.activeElement === select) return;
    var current = select.value;
    var touched = select.dataset.touched === "1";
    clear(select);
    select.appendChild(el("option", null, placeholder));
    select.lastChild.value = "";
    options.forEach(function (option) {
      var node = el("option", null, option.label);
      node.value = String(option.value);
      select.appendChild(node);
    });
    var hasCurrent = options.some(function (option) { return String(option.value) === current; });
    if (touched && (current === "" || hasCurrent)) select.value = current;
    else if (preferFirst && options.length) select.value = String(options[0].value);
    else select.value = hasCurrent ? current : "";
  }

  function renderBrand() {
    var profile = state.profile;
    document.getElementById("site-name").textContent = profile.title;
    var note = document.getElementById("site-note");
    note.textContent = profile.note || "";
    note.hidden = !profile.note;
    document.title = profile.note ? profile.title + " · " + profile.note : profile.title;
    var nameInput = document.getElementById("site-name-input");
    var noteInput = document.getElementById("site-note-input");
    if (nameInput && document.activeElement !== nameInput) nameInput.value = profile.title;
    if (noteInput && document.activeElement !== noteInput) noteInput.value = profile.note || "";
    document.documentElement.setAttribute("data-theme", profile.theme || "paper");
    document.querySelectorAll("[data-theme-pick]").forEach(function (btn) {
      btn.setAttribute("aria-pressed", btn.getAttribute("data-theme-pick") === profile.theme ? "true" : "false");
    });
    try { localStorage.setItem("daydesk-theme", profile.theme || "paper"); } catch (e) {}
    document.getElementById("sidebar-foot").textContent = "第 " + state.clock.week + " 周";
    document.getElementById("risk-note").textContent =
      "逾期，或等待别人超过 " + state.rules.wait_nudge_days + " 天";
    document.getElementById("inbox-hint").textContent =
      "和首页是同一条清单。超过 " + state.rules.inbox_nudge_days + " 天会在日复盘里再问你。";
    document.getElementById("hold-hint").textContent =
      "先放着。超过 " + state.rules.hold_nudge_days + " 天，周五必须再选一次。";
  }

  function renderToday() {
    document.getElementById("today-kicker").textContent = state.clock.kicker;
    document.getElementById("today-heading").textContent = state.clock.heading;
    var top = document.getElementById("top3");
    clear(top);
    if (!state.top3.length) {
      top.appendChild(emptyNote("今天还没有待办。要加的话，去待办里写一条。"));
    }
    state.top3.forEach(function (todo, index) {
      top.appendChild(taskCard(todo, String(index + 1).padStart(2, "0")));
    });
    var risks = document.getElementById("risks");
    clear(risks);
    if (!state.risks.length) risks.appendChild(emptyNote("没有逾期，也没有等太久的事。"));
    state.risks.forEach(function (todo) {
      risks.appendChild(taskCard(todo, todo.status === "waiting" ? "…" : "!"));
    });
    renderTimes();
    renderGoals();
    renderInbox(document.getElementById("inbox"), true);
    var aged = state.inbox.filter(function (item) { return item.aged; }).length;
    var count = document.getElementById("inbox-count");
    count.textContent = state.inbox.length
      ? state.inbox.length + " 条还没决定去向" + (aged ? "，其中 " + aged + " 条超过 " + state.rules.inbox_nudge_days + " 天" : "")
      : "收集箱是空的";
  }

  function renderTimes() {
    var host = document.getElementById("time-list");
    clear(host);
    var today = state.days.filter(function (day) { return day.is_today; })[0];
    var blocks = today ? today.blocks : [];
    if (!blocks.length) {
      host.appendChild(emptyNote("今天还没有排时间。"));
      return;
    }
    var now = minutes(state.clock.now);
    var placed = false;
    blocks.forEach(function (block) {
      if (!placed && minutes(block.end) > now) {
        host.appendChild(el("p", "now-line", "现在 " + state.clock.now));
        placed = true;
      }
      var row = el("div", "time-row");
      row.appendChild(el("time", null, block.start + "–" + block.end));
      var body = el("div");
      body.appendChild(el("strong", null, block.title));
      var notes = [];
      if (minutes(block.start) <= now && minutes(block.end) > now) notes.push("进行中");
      if (block.weekly) notes.push("每周");
      if (block.todo_title) notes.push("挂着「" + block.todo_title + "」");
      if (notes.length) body.appendChild(el("p", "meta", notes.join(" · ")));
      row.appendChild(body);
      host.appendChild(row);
    });
    if (!placed) host.appendChild(el("p", "now-line", "现在 " + state.clock.now));
  }

  function minutes(value) {
    var parts = String(value || "0:0").split(":");
    return Number(parts[0]) * 60 + Number(parts[1]);
  }

  function renderGoals() {
    var host = document.getElementById("goals");
    var edit = document.getElementById("edit-goals");
    if (host.querySelector("form") && host.querySelector("form").dataset.dirty === "1") return;
    edit.hidden = !state.goals.length;
    edit.textContent = goalEditing ? "取消" : "改这三个结果";
    clear(host);
    if (!state.goals.length || goalEditing) {
      host.appendChild(goalForm(state.goals));
      return;
    }
    var stack = el("div", "stack");
    state.goals.forEach(function (goal) {
      var card = el("article", "goal");
      var top = el("div", "goal-top");
      top.appendChild(el("strong", null, goal.title));
      top.appendChild(el("span", null, goal.percent + "%"));
      card.appendChild(top);
      var bar = el("div", "bar");
      bar.setAttribute("role", "img");
      bar.setAttribute("aria-label", goal.title + "，完成 " + goal.percent + "%");
      var fill = el("span");
      fill.style.width = goal.percent + "%";
      bar.appendChild(fill);
      card.appendChild(bar);
      card.appendChild(el("p", "meta", goal.line));
      stack.appendChild(card);
    });
    host.appendChild(stack);
  }

  function goalForm(goals) {
    var form = el("form", "form-grid");
    form.id = "goal-form";
    var slots = state.rules.goal_slots;
    for (var i = 0; i < slots; i += 1) {
      var label = el("label", "field", "结果 " + (i + 1));
      var input = document.createElement("input");
      input.type = "text";
      input.name = "goal";
      input.maxLength = 80;
      input.value = goals[i] ? goals[i].title : "";
      input.placeholder = i === 0 ? "例如：把阶段文档交出去" : "可以空着";
      label.appendChild(input);
      form.appendChild(label);
    }
    form.appendChild(button("btn btn-primary", state.goals.length ? "保存这三个结果" : "写下本周要交的"));
    form.lastChild.type = "submit";
    return form;
  }

  function renderInbox(host, withActions) {
    clear(host);
    if (!state.inbox.length) {
      host.appendChild(el("li", "hint", "上面记一句，就会出现在这里。"));
      return;
    }
    state.inbox.forEach(function (spark) {
      host.appendChild(sparkCard(spark, withActions));
    });
  }

  function renderTodos() {
    var goalSelect = document.getElementById("todo-goal");
    fillSelect(
      goalSelect,
      state.goals.map(function (goal) { return { value: goal.id, label: goal.title }; }),
      "先不挂",
      true
    );
    var hint = document.getElementById("goal-hint");
    var jump = document.getElementById("goal-jump");
    if (!state.goals.length) {
      hint.textContent = "本周还没有要交的结果，所以只能先不挂。写好之后，新待办会默认挂上第一条。";
      jump.hidden = false;
    } else {
      hint.textContent = "默认挂到本周第一条结果。想单独放着，再改成先不挂。";
      jump.hidden = true;
    }
    var list = document.getElementById("todo-list");
    clear(list);
    var rows = state.todos.filter(function (todo) {
      return todoFilter === "all" || todo.kind === todoFilter;
    });
    if (!rows.length) list.appendChild(el("li", "hint", "这一栏是空的。"));
    rows.forEach(function (todo) {
      var item = el("li", "card entry");
      item.hidden = false;
      item.appendChild(el("strong", null, todo.title));
      item.appendChild(metaLine(todo.meta, todo.flags));
      if (todo.actions.length) item.appendChild(actionButtons(todo));
      list.appendChild(item);
    });
    var form = document.getElementById("todo-form");
    var toggle = document.getElementById("add-todo");
    form.hidden = !todoFormOpen;
    toggle.setAttribute("aria-expanded", todoFormOpen ? "true" : "false");
    toggle.textContent = todoFormOpen ? "收起表单" : "新增待办";
  }

  function renderSparks() {
    fillList("spark-inbox", state.inbox, function (spark) { return sparkCard(spark, true); }, "收集箱是空的。");
    fillList("spark-hold", state.holds, function (spark) {
      return sparkCard(spark, spark.aged);
    }, "没有先放着的灵感。");
    fillList("spark-write", state.writing, function (spark) {
      var card = el("li", "card entry");
      card.appendChild(el("strong", null, spark.title));
      card.appendChild(el("p", "meta", spark.meta));
      card.appendChild(button("btn btn-ghost", "继续写", { "data-open": "edit-write", "data-spark": spark.id }));
      return card;
    }, "还没有开写的文章。");
    fillList("spark-try", state.practices, function (spark) {
      var card = el("li", "card entry");
      card.appendChild(el("strong", null, spark.title));
      card.appendChild(el("p", "meta", spark.meta));
      card.appendChild(button("btn btn-ghost", "记下结果", { "data-open": "edit-try", "data-spark": spark.id }));
      return card;
    }, "还没有正在做的实践。");
    fillList("spark-settled", state.settled, function (spark) {
      var card = el("li", "card entry");
      card.appendChild(el("strong", null, spark.title));
      card.appendChild(metaLine([], [{ tone: "ok", text: spark.outcome === "article" ? "已成文" : "已实践" }]));
      return card;
    }, "这周还没有落成的文章或实践。");
  }

  function fillList(id, items, build, empty) {
    var host = document.getElementById(id);
    clear(host);
    if (!items.length) {
      host.appendChild(el(host.tagName === "UL" ? "li" : "p", "hint", empty));
      return;
    }
    items.forEach(function (item) { host.appendChild(build(item)); });
  }

  function currentDay() {
    var days = state.days || [];
    if (!days.some(function (day) { return day.date === selectedDay; })) selectedDay = state.clock.today;
    return selectedDay;
  }

  function renderSchedule() {
    document.getElementById("schedule-kicker").textContent = state.clock.schedule_kicker;
    var chosen = currentDay();
    var week = document.getElementById("week");
    clear(week);
    state.days.forEach(function (day) {
      var card = el("article", "week-day" + (day.is_today ? " is-today" : ""));
      card.setAttribute("role", "listitem");
      var pick = button("week-pick", "", { "data-day": day.date, "aria-pressed": day.date === chosen ? "true" : "false" });
      pick.appendChild(el("span", "week-wd", day.weekday));
      pick.appendChild(el("span", "week-num", String(day.day)));
      if (day.is_today) pick.appendChild(el("span", "week-tag", "今天"));
      card.appendChild(pick);
      card.appendChild(el("p", "week-summary", day.summary));
      var list = el("ul", "week-detail");
      day.blocks.forEach(function (block) {
        var item = el("li");
        item.appendChild(el("time", null, block.start + "–" + block.end));
        var line = el("div", "week-line");
        line.appendChild(el("span", null, block.title));
        if (block.weekly) line.appendChild(el("span", "flag", "每周"));
        var remove = block.weekly
          ? button("btn btn-quiet", "取消每周", { "data-delete-routine": block.id, "aria-label": "取消每周的「" + block.title + "」" })
          : button("btn btn-quiet", "去掉", { "data-delete-block": block.id, "aria-label": "去掉「" + block.title + "」" });
        line.appendChild(remove);
        item.appendChild(line);
        list.appendChild(item);
      });
      card.appendChild(list);
      week.appendChild(card);
    });
    var chosenDay = state.days.filter(function (day) { return day.date === chosen; })[0];
    document.getElementById("block-submit").textContent = "加到" + (chosenDay ? chosenDay.weekday : "这一天");
    fillSelect(
      document.getElementById("block-todo"),
      state.todos.filter(function (todo) { return todo.status === "open" || todo.status === "waiting"; })
        .map(function (todo) { return { value: todo.id, label: todo.title }; }),
      "不挂"
    );
  }

  function renderDaily() {
    var done = document.getElementById("daily-done");
    clear(done);
    if (!state.daily.done.length) done.appendChild(el("li", "plain-empty", "今天还没有勾掉的待办。"));
    state.daily.done.forEach(function (item) {
      var line = item.title + (item.goal_title ? "，推进了「" + item.goal_title + "」" : "");
      var row = el("li", "done-item");
      row.appendChild(el("span", "flag flag-ok", "已完成"));
      row.appendChild(el("span", null, line));
      done.appendChild(row);
    });
    if (!kept("daily-open-step")) renderOpen();
    if (!kept("daily-form-step")) {
      var saved = state.daily.saved;
      var next = saved ? saved.next : state.top3.map(function (todo) { return todo.title; });
      document.querySelector("#daily-form [name=blocker]").value = saved ? saved.blocker : "";
      document.querySelector("#daily-form [name=next1]").value = next[0] || "";
      document.querySelector("#daily-form [name=next2]").value = next[1] || "";
      document.querySelector("#daily-form [name=next3]").value = next[2] || "";
    }
    var aged = document.getElementById("daily-aged");
    clear(aged);
    if (!state.daily.aged.length) {
      aged.appendChild(emptyNote("没有超过 " + state.rules.inbox_nudge_days + " 天还没分流的灵感。"));
    } else {
      state.daily.aged.forEach(function (spark) { aged.appendChild(sparkCard(spark, true)); });
    }
  }

  function renderOpen() {
    var host = document.getElementById("daily-open");
    clear(host);
    if (!state.daily.open.length) {
      host.appendChild(emptyNote("没有还压在今天的事。"));
      return;
    }
    state.daily.open.forEach(function (todo) {
      var card = el("div", "card open-card");
      card.setAttribute("data-todo", todo.id);
      var status = el("p", "meta");
      status.appendChild(el("span", "flag flag-warn", "未完成"));
      card.appendChild(status);
      card.appendChild(el("strong", null, todo.title));
      card.appendChild(metaLine(todo.meta, todo.flags));
      var stuck = todo.postpone_count >= state.rules.postpone_limit;
      var choice = el("div", "choice");
      choice.setAttribute("role", "group");
      choice.setAttribute("aria-label", todo.title + "怎么处理");
      if (!stuck) {
        choice.appendChild(button("btn btn-quiet", "明天", { "data-choice": "tomorrow", "aria-pressed": "true" }));
        choice.appendChild(button("btn btn-quiet", "改期", { "data-choice": "reschedule", "aria-pressed": "false" }));
      }
      choice.appendChild(button("btn btn-quiet", "放弃", { "data-choice": "drop", "aria-pressed": stuck ? "true" : "false" }));
      card.appendChild(choice);
      if (!stuck) {
        var date = document.createElement("input");
        date.type = "date";
        date.value = addDays(state.clock.today, 1);
        date.hidden = true;
        date.setAttribute("aria-label", "改到哪一天");
        card.appendChild(date);
      }
      host.appendChild(card);
    });
  }

  function renderWeekly() {
    fillPlain("weekly-done", state.weekly.done, "这周还没有完成的记录。", true);
    fillPlain("weekly-gaps", state.weekly.gaps, "本周还没有写下要交出去的结果。");
    fillPlain("weekly-blockers", state.weekly.blockers, "日复盘里还没有写下卡点。");
    var aged = document.getElementById("weekly-aged");
    clear(aged);
    if (!state.weekly.aged.length) {
      aged.appendChild(emptyNote("这周没有培育超过 " + state.rules.hold_nudge_days + " 天的灵感。"));
    } else {
      state.weekly.aged.forEach(function (spark) { aged.appendChild(sparkCard(spark, true)); });
    }
    var form = document.getElementById("weekly-form");
    if (form.dataset.dirty === "1") return;
    var fields = document.getElementById("weekly-fields");
    clear(fields);
    for (var i = 0; i < state.rules.goal_slots; i += 1) {
      var label = el("label", "field", "目标 " + (i + 1));
      var input = document.createElement("input");
      input.type = "text";
      input.name = "goal";
      input.maxLength = 80;
      input.value = state.weekly.next_goals[i] || "";
      input.placeholder = i === 0 ? "例如：把阶段文档交出去" : "可以空着";
      label.appendChild(input);
      fields.appendChild(label);
    }
  }

  function fillPlain(id, lines, empty, marked) {
    var host = document.getElementById(id);
    clear(host);
    if (!lines.length) {
      host.appendChild(el("li", "plain-empty", empty));
      return;
    }
    lines.forEach(function (line) {
      if (!marked) {
        host.appendChild(el("li", "plain-line", line));
        return;
      }
      var row = el("li", "done-item");
      row.appendChild(el("span", "flag flag-ok", "已完成"));
      row.appendChild(el("span", null, line));
      host.appendChild(row);
    });
  }

  function reportText() {
    function block(title, lines) {
      var cleaned = (lines || []).filter(Boolean);
      return title + "\n" + (cleaned.length ? cleaned.map(function (line) { return "- " + line; }).join("\n") : "没有。");
    }
    var goals = Array.from(document.querySelectorAll("#weekly-form [name=goal]")).map(function (input) {
      return input.value.trim();
    }).filter(Boolean);
    return [
      block("一、本周完成", state.weekly.done),
      block("二、目标差距", state.weekly.gaps),
      block("三、问题", state.weekly.blockers),
      block("四、下周重点", goals.length ? goals : state.weekly.next_goals),
    ].join("\n\n");
  }

  function render() {
    if (!state) return;
    renderBrand();
    renderToday();
    renderTodos();
    renderSparks();
    renderSchedule();
    renderDaily();
    renderWeekly();
  }

  function openPiece(mode, spark) {
    var form = document.getElementById("piece-form");
    var writing = mode === "write" || mode === "edit-write";
    form.dataset.mode = mode;
    form.dataset.spark = String(spark.id);
    document.getElementById("piece-kicker").textContent = writing ? "写成文章" : "做一次";
    document.getElementById("piece-title").textContent = spark.title || spark.text;
    clear(form);
    if (writing) {
      form.appendChild(textField("出发点", "origin", spark.origin || spark.text, true));
      form.appendChild(textField("提纲，可先空着", "outline", spark.outline || "", false));
      form.appendChild(textArea("正文", "body", spark.body || ""));
      form.appendChild(el("p", "hint", "状态从构思开始。写成之后会出现在本周已落成，并进入周五的周报。"));
    } else if (mode === "try") {
      form.appendChild(textField("想验证的一件事", "hypothesis", spark.text, true));
      form.appendChild(textField("本周能做完的最小一步", "smallest_step", "", true));
      form.appendChild(el("p", "hint", "确认后会同时生成一条待办，让这一步进今天的列表。"));
    } else {
      form.appendChild(el("p", "meta", "最小一步：" + (spark.smallest_step || "还没写")));
      form.appendChild(textArea("这次的结果", "result", spark.result || ""));
    }
    var row = el("div", "row-actions");
    var primary = button("btn btn-primary", mode === "write" ? "开始写" : mode === "try" ? "开始做这一次" : "保存");
    primary.type = "submit";
    row.appendChild(primary);
    if (mode === "edit-write" || mode === "edit-try") {
      var settle = button("btn btn-quiet", mode === "edit-write" ? "写成了" : "做完了");
      settle.type = "submit";
      settle.dataset.settle = "1";
      row.appendChild(settle);
    }
    form.appendChild(row);
    document.getElementById("piece").showModal();
  }

  function textField(labelText, name, value, required) {
    var wrap = el("label", "field", labelText);
    var input = document.createElement("input");
    input.type = "text";
    input.name = name;
    input.value = value || "";
    input.required = !!required;
    wrap.appendChild(input);
    return wrap;
  }

  function textArea(labelText, name, value) {
    var wrap = el("label", "field", labelText);
    var input = document.createElement("textarea");
    input.name = name;
    input.value = value || "";
    wrap.appendChild(input);
    return wrap;
  }

  document.body.addEventListener("input", function (event) {
    var box = event.target.closest("[data-keep]");
    if (box) box.dataset.dirty = "1";
    var form = event.target.closest("#goal-form");
    if (form) form.dataset.dirty = "1";
  });

  document.body.addEventListener("click", function (event) {
    var go = event.target.closest("[data-go]");
    if (go) {
      show(go.getAttribute("data-go"));
      return;
    }
    var choice = event.target.closest(".choice button");
    if (choice) {
      choice.parentElement.querySelectorAll("button").forEach(function (btn) {
        btn.setAttribute("aria-pressed", btn === choice ? "true" : "false");
      });
      var date = choice.parentElement.parentElement.querySelector("input[type=date]");
      if (date) date.hidden = choice.getAttribute("data-choice") !== "reschedule";
      var keep = choice.closest("[data-keep]");
      if (keep) keep.dataset.dirty = "1";
      return;
    }
    var day = event.target.closest("[data-day]");
    if (day) {
      selectedDay = day.getAttribute("data-day");
      renderSchedule();
      return;
    }
    var done = event.target.closest("[data-done]");
    if (done) {
      send("/api/todos/" + done.getAttribute("data-done") + "/done", "POST").then(function (ok) {
        if (ok) toast("勾掉了。晚上的日复盘会带上这一条。");
      });
      return;
    }
    var postpone = event.target.closest("[data-postpone]");
    if (postpone) {
      send("/api/todos/" + postpone.getAttribute("data-postpone") + "/postpone", "POST").then(function (ok) {
        if (ok) toast("放到明天，顺延次数加 1。满 " + state.rules.postpone_limit + " 次后只剩做掉或删掉。");
      });
      return;
    }
    var drop = event.target.closest("[data-drop]");
    if (drop) {
      if (!window.confirm("删掉这条？它不会再算进周复盘。")) return;
      send("/api/todos/" + drop.getAttribute("data-drop") + "/drop", "POST").then(function (ok) {
        if (ok) toast("已删掉。");
      });
      return;
    }
    var wait = event.target.closest("[data-wait]");
    if (wait) {
      toast("先保持等待。满 " + state.rules.wait_nudge_days + " 天会一直留在这里。");
      return;
    }
    var act = event.target.closest("[data-act]");
    if (act) {
      var kind = act.getAttribute("data-act");
      var sparkId = act.getAttribute("data-spark");
      if (kind === "write" || kind === "try") {
        var spark = findSpark(sparkId);
        if (spark) openPiece(kind, spark);
        return;
      }
      send("/api/sparks/" + sparkId + "/flow", "POST", { action: kind }).then(function (ok) {
        if (!ok) return;
        if (kind === "hold") {
          toast("先放着。超过 " + state.rules.hold_nudge_days + " 天，周五会再问你一次。");
          show("sparks");
        } else {
          toast("已变成待办。可以再去补目标和日期。");
          show("todos");
        }
      });
      return;
    }
    var open = event.target.closest("[data-open]");
    if (open) {
      var existing = findSpark(open.getAttribute("data-spark"));
      if (existing) openPiece(open.getAttribute("data-open"), existing);
      return;
    }
    var remove = event.target.closest("[data-delete-block], [data-delete-routine]");
    if (remove) {
      var routine = remove.hasAttribute("data-delete-routine");
      var id = routine ? remove.getAttribute("data-delete-routine") : remove.getAttribute("data-delete-block");
      send((routine ? "/api/routines/" : "/api/blocks/") + id, "DELETE").then(function (ok) {
        if (ok) toast(routine ? "这个每周安排去掉了。" : "这块时间去掉了。");
      });
    }
  });

  document.getElementById("capture-form").addEventListener("submit", function (event) {
    event.preventDefault();
    var input = document.getElementById("capture");
    var text = input.value.trim();
    if (!text) {
      toast("先写一句再收下");
      input.focus();
      return;
    }
    send("/api/sparks", "POST", { text: text }).then(function (ok) {
      if (!ok) return;
      input.value = "";
      toast("已放进收集箱。它可以先躺着，不必马上变成待办。");
    });
  });

  document.getElementById("add-todo").addEventListener("click", function () {
    todoFormOpen = !todoFormOpen;
    renderTodos();
    if (todoFormOpen) {
      var due = document.querySelector("#todo-form [name=due]");
      if (due && !due.value && state) due.value = state.clock.today;
      document.querySelector("#todo-form [name=title]").focus();
    }
  });

  document.getElementById("cancel-todo").addEventListener("click", function () {
    todoFormOpen = false;
    renderTodos();
  });

  document.getElementById("todo-form").addEventListener("submit", function (event) {
    event.preventDefault();
    var data = new FormData(event.target);
    var previous = todoFormOpen;
    todoFormOpen = false;
    send("/api/todos", "POST", {
      title: data.get("title"),
      due_date: data.get("due") || null,
      goal_id: data.get("goal") ? Number(data.get("goal")) : null,
      priority: data.get("priority") || "normal",
      waiting: data.get("waiting") === "on",
    }).then(function (ok) {
      if (!ok) {
        todoFormOpen = previous;
        renderTodos();
        return;
      }
      event.target.reset();
      delete document.getElementById("todo-goal").dataset.touched;
      toast("已加进待办清单。");
    });
  });

  document.getElementById("todo-goal").addEventListener("change", function (event) {
    event.target.dataset.touched = "1";
  });

  document.getElementById("goals").addEventListener("submit", function (event) {
    if (!event.target.matches("#goal-form")) return;
    event.preventDefault();
    var titles = Array.from(event.target.querySelectorAll("[name=goal]")).map(function (input) { return input.value; });
    var wasEditing = goalEditing;
    goalEditing = false;
    event.target.dataset.dirty = "";
    send("/api/goals", "PUT", { goals: titles }).then(function (ok) {
      if (!ok) {
        goalEditing = wasEditing;
        event.target.dataset.dirty = "1";
        return;
      }
      toast("本周要交出去的结果已记下。");
    });
  });

  document.getElementById("edit-goals").addEventListener("click", function () {
    goalEditing = !goalEditing;
    var form = document.getElementById("goal-form");
    if (form) delete form.dataset.dirty;
    renderGoals();
  });

  document.getElementById("block-form").addEventListener("submit", function (event) {
    event.preventDefault();
    var data = new FormData(event.target);
    var day = currentDay();
    var weekly = data.get("weekly") === "on";
    send("/api/blocks", "POST", {
      day: day,
      start: data.get("start"),
      end: data.get("end"),
      title: data.get("title"),
      todo_id: weekly || !data.get("todo") ? null : Number(data.get("todo")),
      repeat: weekly,
    }).then(function (ok) {
      if (!ok) return;
      event.target.reset();
      var todoSelect = document.getElementById("block-todo");
      var weeklyHint = document.getElementById("block-weekly-hint");
      todoSelect.disabled = false;
      weeklyHint.textContent = "只加这一周。勾上之后，下周同一天还会出现。";
      var chosen = state.days.filter(function (item) { return item.date === day; })[0];
      var name = chosen ? chosen.weekday : "这一天";
      toast(weekly ? "以后每周" + name + "的这个时间都会有。" : "已加进" + name + "。");
    });
  });

  document.getElementById("block-weekly").addEventListener("change", function () {
    var todoSelect = document.getElementById("block-todo");
    var weeklyHint = document.getElementById("block-weekly-hint");
    todoSelect.disabled = this.checked;
    weeklyHint.textContent = this.checked
      ? "每周都会有这块时间。它不挂某一条待办。"
      : "只加这一周。勾上之后，下周同一天还会出现。";
  });

  document.getElementById("daily-form").addEventListener("submit", function (event) {
    event.preventDefault();
    var data = new FormData(event.target);
    var items = [];
    document.querySelectorAll("#daily-open [data-todo]").forEach(function (card) {
      var pressed = card.querySelector(".choice button[aria-pressed='true']");
      var date = card.querySelector("input[type=date]");
      items.push({
        todo_id: Number(card.getAttribute("data-todo")),
        action: pressed ? pressed.getAttribute("data-choice") : "tomorrow",
        date: date ? date.value : null,
      });
    });
    document.getElementById("daily-open-step").dataset.dirty = "";
    document.getElementById("daily-form-step").dataset.dirty = "";
    send("/api/reviews/daily", "POST", {
      blocker: data.get("blocker") || "",
      next: [data.get("next1") || "", data.get("next2") || "", data.get("next3") || ""],
      items: items,
    }).then(function (ok) {
      if (!ok) {
        document.getElementById("daily-open-step").dataset.dirty = "1";
        document.getElementById("daily-form-step").dataset.dirty = "1";
        return;
      }
      toast("今天的复盘记下了。");
    });
  });

  document.getElementById("weekly-form").addEventListener("submit", function (event) {
    event.preventDefault();
    var goals = Array.from(event.target.querySelectorAll("[name=goal]")).map(function (input) { return input.value; });
    event.target.dataset.dirty = "";
    send("/api/reviews/weekly", "POST", { goals: goals }).then(function (ok) {
      if (!ok) {
        event.target.dataset.dirty = "1";
        return;
      }
      toast("下周的目标已写下。周一的首页会用它们看差距。");
    });
  });

  document.getElementById("copy-report").addEventListener("click", function () {
    var text = reportText();
    var box = document.getElementById("report-box");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        box.hidden = true;
        toast("周报已复制。粘贴到邮件或文档即可。");
      }, function () {
        showReport(box, text);
      });
    } else {
      showReport(box, text);
    }
  });

  function showReport(box, text) {
    box.hidden = false;
    box.value = text;
    box.focus();
    box.select();
    toast("剪贴板没打开。文字在下面，可以手动复制。");
  }

  document.getElementById("name-form").addEventListener("submit", function (event) {
    event.preventDefault();
    var data = new FormData(event.target);
    send("/api/profile", "PUT", {
      title: data.get("name"),
      note: data.get("note") || "",
      theme: state.profile.theme || "paper",
    }).then(function (ok) {
      if (ok) toast("左上角已更新。");
    });
  });

  document.querySelectorAll("[data-theme-pick]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (!state) return;
      send("/api/profile", "PUT", {
        title: state.profile.title,
        note: state.profile.note,
        theme: btn.getAttribute("data-theme-pick"),
      });
    });
  });

  document.querySelectorAll(".filters [data-filter]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      todoFilter = btn.getAttribute("data-filter");
      document.querySelectorAll(".filters [data-filter]").forEach(function (peer) {
        peer.setAttribute("aria-pressed", peer === btn ? "true" : "false");
      });
      renderTodos();
    });
  });

  document.getElementById("piece-close").addEventListener("click", function () {
    document.getElementById("piece").close();
  });

  document.getElementById("piece-form").addEventListener("submit", function (event) {
    event.preventDefault();
    var form = event.target;
    var data = Object.fromEntries(new FormData(form).entries());
    var mode = form.dataset.mode;
    var sparkId = form.dataset.spark;
    var settle = event.submitter && event.submitter.dataset.settle === "1";
    var path = "/api/sparks/" + sparkId + (mode === "write" || mode === "try" ? "/flow" : "");
    var method = mode === "write" || mode === "try" ? "POST" : "PATCH";
    var body = mode === "write" || mode === "try"
      ? Object.assign({ action: mode === "write" ? "write" : "try" }, data)
      : Object.assign({}, data, { settle: settle });
    send(path, method, body).then(function (ok) {
      if (!ok) return;
      document.getElementById("piece").close();
      if (mode === "try") toast("实践已记下，最小一步也进了待办。");
      else if (mode === "write") toast("文章已开篇。写完后会算进本周已落成。");
      else if (settle) toast(mode === "edit-write" ? "这篇算进本周已落成了。" : "这次实践做完了。");
      else toast("先留着。");
      show("sparks");
    });
  });

  window.addEventListener("hashchange", function () {
    show(location.hash.slice(1));
  });

  api("/api/board").then(function (body) {
    state = body;
    render();
    if (location.hash) show(location.hash.slice(1));
  }).catch(function (err) {
    if (err.message !== "需要口令") toast(err.message || "工作台没有打开");
  });
})();
