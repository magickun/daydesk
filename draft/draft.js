(function () {
  var toastTimer = null;
  var pendingSpark = null;

  function toast(message) {
    var el = document.getElementById("toast");
    el.textContent = message;
    el.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove("is-on");
    }, 3200);
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
      var match = btn.getAttribute("data-go") === view || (view === "weekly" && btn.getAttribute("data-go") === "daily");
      if (match) btn.setAttribute("aria-current", "page");
      else btn.removeAttribute("aria-current");
    });
    if (location.hash !== "#" + view) history.replaceState(null, "", "#" + view);
    var main = document.getElementById("main");
    if (main) main.focus({ preventScroll: true });
    mirrorInbox();
  }

  document.querySelectorAll("[data-go]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      show(btn.getAttribute("data-go"));
    });
  });

  window.addEventListener("hashchange", function () {
    show(location.hash.slice(1));
  });

  function mirrorInbox() {
    var home = document.getElementById("inbox");
    var page = document.getElementById("spark-inbox");
    if (!home || !page) return;
    page.innerHTML = "";
    home.querySelectorAll(".spark").forEach(function (item) {
      page.appendChild(item.cloneNode(true));
    });
    var n = home.querySelectorAll(".spark").length;
    var aged = home.querySelectorAll(".aged").length;
    var count = document.getElementById("inbox-count");
    if (count) {
      count.textContent = n
        ? n + " 条还没决定去向" + (aged ? "，其中 " + aged + " 条超过 3 天" : "")
        : "收集箱空了";
    }
  }

  document.getElementById("capture-form").addEventListener("submit", function (event) {
    event.preventDefault();
    var input = document.getElementById("capture");
    var text = input.value.trim();
    if (!text) {
      toast("先写一句再收下");
      input.focus();
      return;
    }
    var li = document.createElement("li");
    li.className = "card spark";
    li.innerHTML =
      "<p></p><p class=\"meta\">刚刚</p>" +
      "<div class=\"spark-actions\">" +
      "<button class=\"btn btn-quiet\" type=\"button\" data-act=\"todo\">转待办</button>" +
      "<button class=\"btn btn-quiet\" type=\"button\" data-act=\"write\">写成文章</button>" +
      "<button class=\"btn btn-quiet\" type=\"button\" data-act=\"try\">做一次</button>" +
      "<button class=\"btn btn-quiet\" type=\"button\" data-act=\"hold\">先放着</button>" +
      "</div>";
    li.querySelector("p").textContent = text;
    document.getElementById("inbox").prepend(li);
    input.value = "";
    mirrorInbox();
    toast("已放进收集箱。它可以先躺着，不必马上变成待办。");
  });

  document.body.addEventListener("click", function (event) {
    var done = event.target.closest(".done-btn");
    if (done) {
      var card = done.closest(".task");
      if (card) card.classList.add("is-done");
      done.textContent = "已完成";
      done.disabled = true;
      toast("勾掉了。晚上的日复盘会带上这一条。");
      return;
    }

    var drop = event.target.closest("[data-drop]");
    if (drop) {
      var row = drop.closest(".task");
      if (row && window.confirm("删掉这条？顺延已经满 5 次。")) {
        row.remove();
        toast("已删掉。周复盘里不会再算它。");
      }
      return;
    }

    var postpone = event.target.closest(".postpone");
    if (postpone) {
      toast("放到明天，顺延次数加 1。满 5 次后只剩做掉或删掉。");
      return;
    }

    var toastBtn = event.target.closest("[data-toast]");
    if (toastBtn) {
      toast(toastBtn.getAttribute("data-toast"));
      return;
    }

    var act = event.target.closest("[data-act]");
    if (act) {
      var spark = act.closest(".spark");
      var sentence = spark ? spark.querySelector("p").textContent : "";
      handleAct(act.getAttribute("data-act"), sentence, spark);
      return;
    }

    var open = event.target.closest("[data-open-piece]");
    if (open) {
      var card = open.closest(".card");
      var title = card ? card.querySelector("strong").textContent : "";
      openPiece(open.getAttribute("data-open-piece"), title, null);
    }
  });

  function handleAct(kind, sentence, spark) {
    if (kind === "hold") {
      moveToHold(sentence, spark);
      return;
    }
    if (kind === "todo") {
      addTodo(sentence);
      removeSpark(spark);
      toast("已变成待办。可以再去补目标和日期。");
      show("todos");
      return;
    }
    pendingSpark = spark;
    openPiece(kind === "write" ? "article" : "practice", sentence, spark);
  }

  function moveToHold(sentence, spark) {
    var li = document.createElement("li");
    li.className = "card spark";
    li.innerHTML = "<p></p><p class=\"meta\">刚刚放进培育</p>";
    li.querySelector("p").textContent = sentence;
    document.getElementById("spark-hold").prepend(li);
    removeSpark(spark);
    toast("先放着。超过 14 天，周五会再问你一次。");
    show("sparks");
  }

  function removeSpark(spark) {
    if (!spark) return;
    var text = spark.querySelector("p").textContent;
    document.querySelectorAll("#inbox .spark").forEach(function (item) {
      if (item.querySelector("p").textContent === text) item.remove();
    });
    mirrorInbox();
  }

  function addTodo(title) {
    var li = document.createElement("li");
    li.className = "card";
    li.setAttribute("data-kind", "today");
    li.innerHTML = "<strong></strong><p class=\"meta\">刚刚从灵感转入 · 还没挂目标</p>";
    li.querySelector("strong").textContent = title;
    document.getElementById("todo-list").prepend(li);
  }

  var piece = document.getElementById("piece");
  var pieceForm = document.getElementById("piece-form");

  function openPiece(type, sentence) {
    var article = type === "article";
    document.getElementById("piece-kicker").textContent = article ? "写成文章" : "做一次";
    document.getElementById("piece-title").textContent = sentence || (article ? "继续这篇文章" : "记下这次实践");
    pieceForm.innerHTML = article
      ? [
          field("出发点", "text", sentence, true),
          field("提纲，可先空着", "text", "", false),
          area("正文"),
          "<p class=\"hint\">状态从构思开始。写成之后会出现在本周已落成，并进入周五的周报。</p>",
          "<button class=\"btn btn-primary\" type=\"submit\">开始写</button>"
        ].join("")
      : [
          field("想验证的一件事", "text", sentence, true),
          field("本周能做完的最小一步", "text", "", true),
          "<p class=\"hint\">确认后会同时生成一条待办，让这一步进今天的列表。</p>",
          "<button class=\"btn btn-primary\" type=\"submit\">开始做这一次</button>"
        ].join("");
    pieceForm.setAttribute("data-type", article ? "article" : "practice");
    piece.showModal();
  }

  function field(label, type, value, required) {
    return (
      "<label class=\"field\">" + label +
      "<input type=\"" + type + "\" value=\"" + escapeAttr(value || "") + "\"" + (required ? " required" : "") + ">" +
      "</label>"
    );
  }

  function area(label) {
    return "<label class=\"field\">" + label + "<textarea></textarea></label>";
  }

  function escapeAttr(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }

  document.getElementById("piece-close").addEventListener("click", function () {
    piece.close();
  });

  pieceForm.addEventListener("submit", function (event) {
    event.preventDefault();
    var type = pieceForm.getAttribute("data-type");
    var sentence = document.getElementById("piece-title").textContent;
    if (type === "article") {
      var li = document.createElement("li");
      li.className = "card";
      li.innerHTML = "<strong></strong><p class=\"meta\">构思 · 刚刚从灵感打开</p>";
      li.querySelector("strong").textContent = sentence.slice(0, 28);
      document.getElementById("spark-write").prepend(li);
      toast("文章已开篇。写完后会算进本周已落成。");
    } else {
      var step = pieceForm.querySelectorAll("input")[1].value.trim();
      var liTry = document.createElement("li");
      liTry.className = "card";
      liTry.innerHTML = "<strong></strong><p class=\"meta\"></p>";
      liTry.querySelector("strong").textContent = sentence.slice(0, 28);
      liTry.querySelector(".meta").textContent = "最小一步：" + (step || "还没写");
      document.getElementById("spark-try").prepend(liTry);
      addTodo(step || sentence);
      toast("实践已记下，最小一步也进了待办。");
    }
    removeSpark(pendingSpark);
    pendingSpark = null;
    piece.close();
    show("sparks");
  });

  var todoForm = document.getElementById("todo-form");
  var addTodoBtn = document.getElementById("add-todo");

  function setTodoForm(open) {
    todoForm.hidden = !open;
    addTodoBtn.setAttribute("aria-expanded", open ? "true" : "false");
    addTodoBtn.textContent = open ? "收起表单" : "新增待办";
    if (open) {
      var field = todoForm.querySelector("input");
      if (field) field.focus();
    }
  }

  addTodoBtn.addEventListener("click", function () {
    setTodoForm(todoForm.hidden);
  });
  document.getElementById("cancel-todo").addEventListener("click", function () {
    setTodoForm(false);
  });

  todoForm.addEventListener("submit", function (event) {
    event.preventDefault();
    var data = new FormData(event.target);
    addTodo(data.get("title"));
    var item = document.querySelector("#todo-list li");
    var goal = data.get("goal");
    var due = data.get("due");
    item.querySelector(".meta").textContent =
      (due || "未定日期") + (goal ? " · " + goal : " · 未挂目标");
    event.target.reset();
    setTodoForm(false);
    toast("已加进待办清单。");
  });

  function applyBrand(name, note) {
    var text = String(name || "").trim() || "Daydesk";
    var remark = String(note || "").trim();
    var mark = document.getElementById("site-name");
    var sub = document.getElementById("site-note");
    if (mark) mark.textContent = text;
    if (sub) {
      sub.textContent = remark;
      sub.hidden = !remark;
    }
    document.title = remark ? text + " · " + remark : text;
    var nameInput = document.getElementById("site-name-input");
    var noteInput = document.getElementById("site-note-input");
    if (nameInput && document.activeElement !== nameInput) nameInput.value = text;
    if (noteInput && document.activeElement !== noteInput) noteInput.value = remark;
    try {
      localStorage.setItem("daydesk-name", text);
      localStorage.setItem("daydesk-note", remark);
    } catch (e) {}
  }

  try {
    applyBrand(localStorage.getItem("daydesk-name"), localStorage.getItem("daydesk-note"));
  } catch (e) {}

  document.getElementById("name-form").addEventListener("submit", function (event) {
    event.preventDefault();
    var data = new FormData(event.target);
    applyBrand(data.get("name"), data.get("note"));
    toast("左上角已更新。");
  });

  document.querySelectorAll(".filters [data-filter]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var filter = btn.getAttribute("data-filter");
      document.querySelectorAll(".filters [data-filter]").forEach(function (peer) {
        peer.setAttribute("aria-pressed", peer === btn ? "true" : "false");
      });
      document.querySelectorAll("#todo-list li").forEach(function (li) {
        var kind = li.getAttribute("data-kind");
        li.hidden = filter !== "all" && kind !== filter;
      });
    });
  });

  var DAY_NAME = { "16": "周一", "17": "周二", "18": "周三", "19": "周四", "20": "周五", "21": "周六", "22": "周日" };

  function selectDay(day) {
    document.querySelectorAll(".week-pick").forEach(function (btn) {
      btn.setAttribute("aria-pressed", btn.getAttribute("data-day") === day ? "true" : "false");
    });
    var submit = document.getElementById("block-submit");
    if (submit) submit.textContent = "加到" + (DAY_NAME[day] || "这一天");
  }

  document.querySelectorAll(".week-pick").forEach(function (btn) {
    btn.addEventListener("click", function () {
      selectDay(btn.getAttribute("data-day"));
    });
  });

  document.getElementById("block-form").addEventListener("submit", function (event) {
    event.preventDefault();
    var data = new FormData(event.target);
    var pick = document.querySelector(".week-pick[aria-pressed='true']");
    var day = pick.getAttribute("data-day");
    var host = document.getElementById("day-" + day);
    var li = document.createElement("li");
    li.innerHTML = "<time></time><span></span>";
    li.querySelector("time").textContent = String(data.get("start")).slice(0, 5);
    li.querySelector("span").textContent = data.get("title");
    host.appendChild(li);
    var titles = [];
    host.querySelectorAll("span").forEach(function (node) { titles.push(node.textContent); });
    host.parentElement.querySelector(".week-summary").textContent = titles.join(" · ");
    event.target.reset();
    toast("已加进" + (DAY_NAME[day] || "这一天") + "。");
  });

  function applyTheme(name) {
    document.documentElement.setAttribute("data-theme", name);
    document.querySelectorAll("[data-theme-pick]").forEach(function (btn) {
      btn.setAttribute("aria-pressed", btn.getAttribute("data-theme-pick") === name ? "true" : "false");
    });
    try { localStorage.setItem("daydesk-theme", name); } catch (e) {}
  }

  applyTheme(document.documentElement.getAttribute("data-theme") || "paper");
  document.querySelectorAll("[data-theme-pick]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      applyTheme(btn.getAttribute("data-theme-pick"));
    });
  });

  document.body.addEventListener("click", function (event) {
    var choice = event.target.closest(".choice button");
    if (!choice) return;
    choice.parentElement.querySelectorAll("button").forEach(function (btn) {
      btn.setAttribute("aria-pressed", btn === choice ? "true" : "false");
    });
  });

  document.getElementById("daily-form").addEventListener("submit", function (event) {
    event.preventDefault();
    toast("今天的复盘先留在这页。正式版会写进你自己的服务器。");
  });

  document.getElementById("weekly-form").addEventListener("submit", function (event) {
    event.preventDefault();
    toast("下周的三个目标已记下。正式版会在周一的首页用它们排今天的三件事。");
  });

  document.getElementById("copy-report").addEventListener("click", function () {
    var text = [
      "一、本周完成",
      "发出上周会议纪要。已成文：顺延不是消失。",
      "",
      "二、目标差距",
      "阶段文档交出去，60%。直播流程跑通一次，提纲未写。阅读实践仍是 0%。",
      "",
      "三、问题",
      "会议材料逾期，已顺延。",
      "",
      "四、下周重点",
      "把阶段文档交出去。直播按提纲完整走一遍。"
    ].join("\n");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        toast("周报已复制。粘贴到邮件或文档即可。");
      }, function () {
        toast("没能写入剪贴板。正式版会提供文本框让你自己复制。");
      });
    } else {
      toast("这页草稿没拿到剪贴板权限。");
    }
  });

  var main = document.getElementById("main");
  main.setAttribute("tabindex", "-1");
  mirrorInbox();
  if (location.hash) show(location.hash.slice(1));
})();
