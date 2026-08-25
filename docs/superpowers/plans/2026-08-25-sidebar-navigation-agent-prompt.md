# Prompt For The Implementing Agent

你接手 `/Users/kale/pi-web` 的侧边栏导航优化。请直接完成实现、验证和本地提交，不要只给建议。

先按顺序完整阅读：

1. `/Users/kale/pi-web/docs/superpowers/plans/2026-08-25-sidebar-navigation-handoff.md`
2. `/Users/kale/pi-web/docs/superpowers/plans/2026-08-25-sidebar-navigation-layout.md`
3. `/Users/kale/.agents/skills/superpowers/executing-plans/SKILL.md`
4. `/Users/kale/.agents/skills/superpowers/test-driven-development/SKILL.md`
5. `/Users/kale/.agents/skills/superpowers/verification-before-completion/SKILL.md`
6. `/Users/kale/.agents/skills/impeccable/reference/layout.md`
7. `/Users/kale/.agents/skills/impeccable/reference/craft-floor.md`（UI 编辑前读取）

开始前从仓库运行一次：

```bash
cd /Users/kale/pi-web
node /Users/kale/.agents/skills/impeccable/scripts/context.mjs --target components/CodexSidebar.tsx
git status --short
git diff --check
node --test components/CodexSidebar.test.mjs lib/recent-sessions.test.mjs
```

关键约束：

- 当前 `main` 与 `origin/main` 都是 `3b597b60`，但工作区有 5 个故意保留的未提交源码修改。不要 reset、restore、checkout、clean 或覆盖它们。
- 继续使用当前工作区；不要新建干净 worktree，除非先完整转移现有 dirty diff。
- 保留顶部搜索/添加/隐藏图标位置、Recent 搜索过滤、Recent 收起持久化和现有行高。
- 替换 `Recent max-height: 42% + 内部滚动`，不要微调百分比。
- Recent 与 Projects 必须共享一个 `.codex-sidebar-navigation` 滚动区域。
- 首次初始化只展开当前项目；已有/手动展开状态继续持久化，包括“全部项目展开”。按计划使用 `pi-web:project-disclosure-initialized` 标记。
- Recent 与 Projects 只用空距和统一标题层级区分，不加分隔线、背景带或卡片。
- 强选中背景留给 session；当前 project 只通过文字强调。
- 不增加依赖或新组件抽象。
- 不提交 `.output`、`.tanstack/`、`.impeccable/`。
- 可以按计划创建本地 commit，但不要 push GitHub，直到用户确认视觉效果。

执行方式：严格按实施计划 Task 1 → Task 4，逐步红绿 TDD。每个任务完成后运行计划指定测试并检查 diff。最终必须完成：聚焦测试、完整测试、lint、Impeccable detector、publication build、launchd 重启、HTTP 200、260px/320px 桌面和 390px 移动端的一轮视觉检查。

不要把当前运行中的 `:30141` 当作最新构建证据；之前的构建/重启被中断。Task 4 必须重新构建和重启。

最终回复必须包含：改动文件、行为结果、测试计数、lint/detector/build/service 证据、视觉检查结果、残余风险、本地 commit hash，并明确说明尚未推送 GitHub。
