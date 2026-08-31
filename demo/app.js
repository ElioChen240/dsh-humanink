(() => {
  "use strict";

  const app = document.querySelector("#app");
  const titleInput = document.querySelector("#articleTitle");
  const bodyInput = document.querySelector("#articleBody");
  const toast = document.querySelector("#toast");
  const editorStatus = document.querySelector("#editorStatus");
  const versionLabel = document.querySelector("#versionLabel");
  const wordCount = document.querySelector("#wordCount");
  const editorHint = document.querySelector("#editorHint");
  const naturalScore = document.querySelector("#naturalScore");
  const naturalProgress = document.querySelector("#naturalProgress");
  const zhuqueScore = document.querySelector("#zhuqueScore");
  const humanSegment = document.querySelector("#humanSegment");
  const aiSegment = document.querySelector("#aiSegment");
  const zhuquePanel = document.querySelector('[data-review-panel="zhuque"]');
  const humanizePanel = document.querySelector('[data-review-panel="humanize"]');
  const detectButton = document.querySelector('[data-action="detect"]');
  const initialTitle = titleInput.value;
  const initialBody = bodyInput.value;
  const titleVariants = [
    { type: "经验型", text: "我试了 30 个效率方法，最后留下来的只有一个" },
    { type: "观点型", text: "真正有效的效率方法，往往一点都不酷" },
    { type: "问题型", text: "忙了一整天却没做成事？可能是顺序错了" },
    { type: "故事型", text: "我终于不再把忙碌，当成努力的证据" },
    { type: "结果型", text: "每天只做一件重要的事，我反而完成得更多" }
  ];
  const humanizedBody = "我以前总以为，效率低是因为方法不够多。那段时间我收藏课程、下载工具，认真试过一轮又一轮的时间管理法。日程表排得很满，真正重要的事却总往后拖。\n\n后来我才发现，问题不是不会安排时间，而是没有先决定什么值得被安排。如果一个方法只让我继续安排，却没有帮我决定先做什么，那它其实只是把“忙”排得更整齐。\n\n现在我只保留一个习惯：每天开始前，写下今天最重要的一件事。它不一定最紧急，但一定是做完之后，我会觉得这一天没有被浪费的事。\n\n这个方法不漂亮，也不适合做成一张打卡海报。但它确实让我少了一点焦虑，多了一点真正完成事情的时间。";
  const state = {
    title: initialTitle,
    body: initialBody,
    version: 3,
    mode: "standard",
    humanized: false,
    detection: "idle",
    detectionScore: 38,
    titleIndex: 0,
    reviewTab: "humanize"
  };
  let toastTimer;

  const showToast = (message) => {
    toast.textContent = message;
    toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2600);
  };

  const updateCount = () => {
    const count = bodyInput.value.replace(/\s/g, "").length;
    wordCount.textContent = `${count.toLocaleString("zh-CN")} 字`;
  };

  const setSavedState = (message = "已保存") => {
    editorStatus.textContent = message;
    window.setTimeout(() => {
      if (editorStatus.textContent === message) editorStatus.textContent = "正在编辑";
    }, 1700);
  };

  const selectTitle = (text, announce = true) => {
    state.title = text;
    titleInput.value = text;
    document.querySelectorAll("[data-title-option]").forEach((option) => {
      const selected = option.dataset.titleOption === text;
      option.classList.toggle("is-selected", selected);
      option.setAttribute("aria-pressed", String(selected));
    });
    if (announce) showToast("标题已切换，正文承诺会在复核时重新检查");
  };

  const renderTitleOptions = () => {
    const container = document.querySelector("#titleOptions");
    container.innerHTML = titleVariants.slice(0, 3).map((variant) => `
      <button class="title-option${variant.text === state.title ? " is-selected" : ""}" type="button" data-title-option="${variant.text}" aria-pressed="${variant.text === state.title}">
        <span class="title-type">${variant.type}</span>
        <strong>${variant.text}</strong>
        <span class="title-check">✓</span>
      </button>
    `).join("");
    container.querySelectorAll("[data-title-option]").forEach((option) => {
      option.addEventListener("click", () => selectTitle(option.dataset.titleOption));
    });
  };

  const setReviewTab = (tab) => {
    state.reviewTab = tab;
    document.querySelectorAll("[data-review-tab]").forEach((button) => {
      const active = button.dataset.reviewTab === tab;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
    humanizePanel.classList.toggle("is-hidden", tab !== "humanize");
    zhuquePanel.classList.toggle("is-hidden", tab !== "zhuque");
    humanizePanel.setAttribute("aria-hidden", String(tab !== "humanize"));
    zhuquePanel.setAttribute("aria-hidden", String(tab !== "zhuque"));
  };

  const setMode = (mode) => {
    state.mode = mode;
    document.querySelectorAll("[data-mode]").forEach((button) => {
      const active = button.dataset.mode === mode;
      button.classList.toggle("is-selected", active);
      button.setAttribute("aria-pressed", String(active));
    });
    const labels = { light: "轻度", standard: "标准", deep: "深度" };
    editorHint.textContent = `${labels[mode]}模式 · 保留你的判断`;
    showToast(`已切换为${labels[mode]}人味化`);
  };

  const runHumanize = () => {
    const button = document.querySelector('[data-action="humanize"]');
    button.disabled = true;
    button.innerHTML = '<span class="button-icon button-spinner">◌</span> 正在处理…';
    editorStatus.textContent = "人味化处理中";
    window.setTimeout(() => {
      bodyInput.value = state.mode === "light" ? bodyInput.value.replace("效率低是因为方法不够多", "效率低，常常不是因为方法不够多") : humanizedBody;
      state.body = bodyInput.value;
      state.version = Math.max(4, state.version + 1);
      state.humanized = true;
      versionLabel.textContent = `v${state.version}`;
      naturalScore.textContent = state.mode === "deep" ? "91" : "88";
      naturalProgress.style.width = `${state.mode === "deep" ? 91 : 88}%`;
      editorHint.textContent = "核心观点保留 · 4 处模板化表达已处理";
      button.disabled = false;
      button.innerHTML = '<span class="button-icon">✦</span> 继续人味化';
      setSavedState("已保存新版本");
      updateCount();
      showToast(`人味化完成，已保存为 v${state.version}`);
    }, 900);
  };

  const runDetection = () => {
    if (state.detection === "running") return;
    state.detection = "running";
    detectButton.disabled = true;
    detectButton.setAttribute("aria-busy", "true");
    detectButton.innerHTML = '<span class="button-icon button-spinner">◌</span> 检测中…';
    zhuqueScore.textContent = "—";
    document.querySelector(".reference-label").textContent = "正在复核";
    showToast("正在检查当前文章版本 · 演示数据");
    window.setTimeout(() => {
      state.detection = "succeeded";
      state.detectionScore = state.humanized ? 31 : 38;
      zhuqueScore.textContent = `${state.detectionScore}%`;
      aiSegment.style.width = `${state.detectionScore}%`;
      humanSegment.style.width = `${100 - state.detectionScore}%`;
      document.querySelector(".legend-row span:last-child").innerHTML = `<i class="legend-dot legend-dot--ai"></i>需复核 ${state.detectionScore}%`;
      document.querySelector(".reference-label").textContent = "仅供复核";
      detectButton.disabled = false;
      detectButton.removeAttribute("aria-busy");
      detectButton.innerHTML = '<span class="button-icon">⌁</span> 重新检测当前版本';
      showToast(`朱雀检测完成 · 当前版本 v${state.version}`);
    }, 1200);
  };

  const focusFinding = (finding) => {
    const targetMap = {
      "场景细节": "问题不是不会安排时间",
      "表达节奏": "一个方法如果不能帮我做出选择",
      "标题支撑": "30 个",
      "朱雀段落 2": "后来我才发现"
    };
    const needle = targetMap[finding];
    const index = needle ? bodyInput.value.indexOf(needle) : -1;
    bodyInput.focus();
    if (index >= 0) {
      bodyInput.setSelectionRange(index, index + needle.length);
      showToast(`已定位到「${needle}」 · 建议先补充真实细节`);
    } else {
      showToast("这条建议需要结合当前文章内容人工确认");
    }
  };

  const resetContent = () => {
    state.title = initialTitle;
    state.body = initialBody;
    state.version = 3;
    state.humanized = false;
    state.detection = "idle";
    state.detectionScore = 38;
    titleInput.value = initialTitle;
    bodyInput.value = initialBody;
    versionLabel.textContent = "v3";
    naturalScore.textContent = "78";
    naturalProgress.style.width = "78%";
    zhuqueScore.textContent = "38%";
    aiSegment.style.width = "38%";
    humanSegment.style.width = "62%";
    document.querySelector(".legend-row span:last-child").innerHTML = '<i class="legend-dot legend-dot--ai"></i>需复核 38%';
    editorHint.textContent = "还可以更具体一点";
    selectTitle(initialTitle, false);
    setReviewTab("humanize");
    updateCount();
    setSavedState("已创建新内容");
    showToast("已创建新的内容草稿");
  };

  const exportArticle = () => {
    const markdown = `# ${titleInput.value.trim()}\n\n${bodyInput.value.trim()}\n\n---\n\nHumanInk 发布前复核：演示数据，仅供参考。`;
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "humanink-article-demo.md";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    showToast("文章已导出为 Markdown");
  };

  document.addEventListener("click", (event) => {
    const actionTarget = event.target.closest("[data-action]");
    const titleTarget = event.target.closest("[data-title-option]");
    const reviewTarget = event.target.closest("[data-review-tab]");
    const navTarget = event.target.closest("[data-nav]");
    const stepTarget = event.target.closest("[data-step]");
    const findingTarget = event.target.closest("[data-finding]");
    const modeTarget = event.target.closest("[data-mode]");

    if (titleTarget) selectTitle(titleTarget.dataset.titleOption);
    if (reviewTarget) setReviewTab(reviewTarget.dataset.reviewTab);
    if (modeTarget) setMode(modeTarget.dataset.mode);
    if (findingTarget) focusFinding(findingTarget.dataset.finding);
    if (navTarget) {
      document.querySelectorAll(".nav-item, .project-item").forEach((item) => item.classList.toggle("is-active", item === navTarget));
      showToast(`${navTarget.dataset.nav} · Demo 导航预览`);
    }
    if (stepTarget) {
      document.querySelectorAll(".workflow-step").forEach((item) => item.classList.toggle("is-active", item === stepTarget));
      showToast(`已切换到「${stepTarget.dataset.step}」视图 · 当前为交互 Demo`);
    }
    if (!actionTarget) return;
    const action = actionTarget.dataset.action;
    if (action === "humanize") runHumanize();
    if (action === "detect") runDetection();
    if (action === "generate-title") {
      state.titleIndex = (state.titleIndex + 1) % titleVariants.length;
      const next = titleVariants[state.titleIndex];
      selectTitle(next.text, false);
      renderTitleOptions();
      showToast("已生成一组新的标题方向");
    }
    if (action === "toggle-theme") {
      const nextTheme = app.dataset.theme === "light" ? "dark" : "light";
      app.dataset.theme = nextTheme;
      actionTarget.setAttribute("aria-label", nextTheme === "dark" ? "切换到浅色主题" : "切换到深色主题");
      showToast(nextTheme === "dark" ? "已切换到深色主题" : "已切换到浅色主题");
    }
    if (action === "new-content") resetContent();
    if (action === "export") exportArticle();
    if (["profile", "more", "visual", "insert-note", "format-bold", "format-italic", "format-list"].includes(action)) {
      const messages = {
        profile: "创作者档案：林默 · 写给真实的人",
        more: "更多操作将在正式工作台中展开",
        visual: "视觉能力预览：配图建议与封面 brief 将在 P1 接入",
        "insert-note": "素材卡已准备好：把真实经历放进文章",
        "format-bold": "粗体工具已选中 · Demo 仅展示交互",
        "format-italic": "斜体工具已选中 · Demo 仅展示交互",
        "format-list": "列表工具已选中 · Demo 仅展示交互"
      };
      showToast(messages[action]);
    }
  });

  titleInput.addEventListener("input", () => {
    state.title = titleInput.value;
    setSavedState("正在保存");
  });

  bodyInput.addEventListener("input", () => {
    state.body = bodyInput.value;
    updateCount();
    setSavedState("正在保存");
  });

  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      setSavedState("已保存");
      showToast("草稿已保存");
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      showToast("快速操作：标题、人味化、朱雀检测、导出");
    }
  });

  renderTitleOptions();
  updateCount();
})();
