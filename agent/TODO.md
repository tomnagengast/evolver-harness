# Future Improvements

## Project-Aware Principle Retrieval

**Problem**: Currently principles are stored globally without project context. A principle like "use bun not npm" would be retrieved for *all* TypeScript projects, even those using npm.

**Current behavior**: Retrieval is purely embedding-based similarity (matching EvolveR paper approach). Triples exist but aren't used as filters.

**Options to explore**:

1. **Let embeddings handle it naturally** - context in the query might naturally rank relevant principles higher. Simple but unpredictable.

2. **Prepend project context to queries** - detect project type at session start, modify embedding queries like `"[bun project] how do I install packages"`. Nudges similarity without schema changes.

3. **Hard filter by triples** - store `{ subject: "runtime", relation: "requires", object: "bun" }` on principles, filter by matching project context before ranking. More predictable but adds complexity.

**Detection signals**:
- `bun.lockb` → Bun project
- `package-lock.json` → npm project
- `yarn.lock` → Yarn project
- `pnpm-lock.yaml` → pnpm project
- `pyproject.toml` / `requirements.txt` → Python
- `Cargo.toml` → Rust
- etc.

**Reference**: EvolveR paper (arxiv 2510.16079) uses pure embedding similarity with no task-type filtering. Triples are for semantic enrichment and deduplication, not retrieval filtering.
