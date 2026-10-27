# 参与贡献

感谢你愿意改进论文星图！无论是报告问题、改进文档，还是提交代码，都非常欢迎。

## 报告问题

提交 Issue 时请尽量附上：

- 复现步骤，以及期望结果与实际结果；
- 浏览器和操作系统版本；
- 如果是解析或翻译问题，请提供论文的公开链接（如 arXiv 地址），方便复现。

**不要在 Issue 中粘贴你的 API Key。**

## 本地开发

```bash
git clone https://github.com/northflower/paper-galaxy.git
cd paper-galaxy
npm run setup
npm run dev
```

目录结构与技术栈见 [README](README.md#-架构与原理)。

## 提交代码

1. Fork 本仓库，基于 `main` 新建分支，例如 `fix/pdf-columns`。
2. 提交前确保检查通过：

   ```bash
   npm run lint
   npx tsc --noEmit -p apps/web
   ```

3. 提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)，例如 `fix(web): 修复单栏论文被误判为双栏`。
4. 发起 Pull Request，说明改动动机；涉及界面的改动请附截图。

## 代码风格

- TypeScript 严格模式，组件只负责交互与渲染，逻辑放在 `lib/` 与 Hook 中；
- 注释说明“为什么”，而不是复述代码；
- 所有 Prompt 集中在 `apps/web/lib/ai/prompts.ts` 管理。
