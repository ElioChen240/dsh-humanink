# HumanInk Interactive HTML5 Demo Implementation Plan

> **For agentic workers:** Implement this plan task-by-task with verification after each task. This demo is an isolated visual prototype; it does not call a live model, Tencent Zhuque API, search service, or image service.

**Goal:** Build a polished, responsive HTML5 prototype that demonstrates the HumanInk MVP workflow from article editing through humanization and Zhuque detection display.

**Architecture:** Use a dependency-free static web demo split into semantic HTML, tokenized responsive CSS, and a small state-driven JavaScript controller. Keep demo data local and make external services explicit as simulated states so the UI can later be connected to Harness providers without changing the interaction contract.

**Tech Stack:** HTML5, CSS3 custom properties/grid, vanilla JavaScript, inline SVG icons, no external runtime dependencies.

## Global Constraints

- Apply the repository `AGENTS.md` workflow: inspect Git before changes, run self-tests after writing, update `VERSION` and `CHANGELOG.md`, commit the completed change, and report the version and commit hash.
- Preserve the approved MVP boundary: general Chinese content workbench, no platform-specific publishing, Humanizer-zh-inspired humanization, Zhuque as a reference detector rather than an automatic score optimizer.
- Keep the demo self-contained and runnable from a static file or a basic local HTTP server.
- Use semantic HTML, visible keyboard focus, reduced-motion support, responsive layouts, and accessible labels for interactive controls.
- Do not imply that demo Zhuque values are live or that a detection result is an absolute human/AI judgment.

---

### Task 1: Create the demo shell and semantic content structure

**Files:**
- Create: `demo/index.html`

**Interfaces:**
- Produces DOM hooks used by `demo/app.js`: `[data-action]`, `[data-title-option]`, `[data-review-tab]`, `#articleTitle`, `#articleBody`, `#reviewPanel`, `#toast`, and status/count elements.
- Loads `demo/styles.css` and `demo/app.js` without external dependencies.

- [ ] Add the branded sidebar, workspace header, workflow stepper, article editor, title alternatives, review panel, Zhuque status area, and mobile-friendly toolbar.
- [ ] Include realistic Chinese demo copy and clearly mark external detection values as demo data.
- [ ] Give every icon-only button an accessible name and every tab/region an appropriate ARIA state.
- [ ] Verify the document has a single `h1`, balanced tags, and no external network dependency.

### Task 2: Implement the responsive visual system

**Files:**
- Create: `demo/styles.css`

**Interfaces:**
- Provides all layout, type, color, focus, loading, selected, error, dark-theme, and reduced-motion styles for `demo/index.html`.
- Uses the CSS custom properties `--bg`, `--surface`, `--ink`, `--muted`, `--accent`, `--line`, `--success`, and `--warning` as the semantic theme contract.

- [ ] Build a calm ink/navy visual language with warm paper surfaces and restrained teal/amber accents.
- [ ] Keep the article editor as the visual focal point; make review status prominent but secondary.
- [ ] Add desktop, tablet, and mobile breakpoints without requiring horizontal scrolling.
- [ ] Add `:hover`, `:active`, `:focus-visible`, selected, disabled, loading, and reduced-motion states.
- [ ] Support a light/dark theme toggle using `[data-theme="dark"]`.

### Task 3: Implement demo interactions and state transitions

**Files:**
- Create: `demo/app.js`

**Interfaces:**
- `demo/app.js` owns local state only and binds to the DOM contract from Task 1.
- Supported actions: `select-title`, `generate-title`, `humanize`, `detect`, `toggle-review`, `toggle-theme`, `new-content`, and `export`.
- State transitions update article text, title, word count, version label, review findings, Zhuque status, and toast feedback without page reload.

- [ ] Implement title selection and title generation with deterministic local demo variants.
- [ ] Implement standard humanization as a simulated asynchronous task that updates the article to a more concrete version and records a new version.
- [ ] Implement Zhuque detection as an explicit simulated asynchronous check with `idle`, `running`, and `succeeded` states; never call an external service or claim live data.
- [ ] Implement review tab switching, theme switching, reset/new-content behavior, and Markdown export.
- [ ] Make loading actions disabled while running and re-enable them after completion.

### Task 4: Run static and browser self-tests

**Files:**
- Test: `demo/index.html`, `demo/styles.css`, `demo/app.js`
- Artifact: `E:/Codex/.codex/visualizations/2026/08/31/01a057a6-a380-7362-9220-b1efd15a62e8/humanink-demo-desktop.png`

- [ ] Run `node --check demo/app.js`.
- [ ] Run a static smoke check that required files, DOM hooks, and key copy are present.
- [ ] Serve the demo locally and use Playwright to verify title selection, humanization, Zhuque detection, theme switching, export, and mobile layout.
- [ ] Capture a desktop screenshot and inspect it visually before claiming the demo is ready.
- [ ] Run `git diff --check` and confirm the working tree contains only the intended demo/version/changelog files.

### Task 5: Commit the demo version

**Files:**
- Modify: `VERSION`
- Modify: `CHANGELOG.md`

- [ ] Increment the repository patch version from `0.1.1` to `0.1.2` for the completed demo deliverable.
- [ ] Add a dated changelog entry describing the interactive HTML5 demo and its simulated HumanInk/Zhuque workflow.
- [ ] Commit with `feat: add HumanInk interactive demo`.
- [ ] Run post-commit status and smoke tests, then report the commit hash and exact test results.
