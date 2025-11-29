# CLAUDE.md

- Be concise and strive for simplicity
- Use `bun` instead of npm, vite – `bunx` instead of `npx`, etc.
- Prefer Bun native APIs over Node.js compatibility layers (e.g., use `Bun.file()` instead of `fs.readFile()`)
- Run linting and typechecking then commit all and push after completing a given task
- Use the `agent/` directory for all temporary notes and scripts
- Prefer parallel tool use and subagents when applicable (read https://www.anthropic.com/engineering/advanced-tool-use)
- Try to keep things in one function unless composable or reusable

