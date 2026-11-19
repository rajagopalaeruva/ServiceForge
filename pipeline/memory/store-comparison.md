# Store comparison for the memory architecture (learning notes)

Purpose: compare the JSON store, ChromaDB and Qdrant by running the same data and queries through all three. This supports `pipeline/memory/adr-memory-store.md`.

Status of the facts below: the product details come from the vendors' getting-started pages and the assistant's general knowledge, read on 2026-11-17. Check versions before relying on them. Nothing here has been installed or run yet.

## 1. How each one works

| | JSON + scoring | ChromaDB | Qdrant |
|---|---|---|---|
| What it is | A file plus your own code | Open-source vector database | Vector database server written in Rust |
| Where it runs | In your script | Embedded in a Python process, or as a server (`chroma run`, Docker) | Server (Docker, a binary, or cloud). The Python client also has a local mode. |
| Who makes the embeddings | None needed | Python and JS clients can embed text for you with a default model. The server does not. | You supply vectors. Python has an optional helper library. |
| Metadata filtering | Plain code | Filters on metadata | Filters on payload, with ranges and nested conditions |
| Hybrid (keyword + vector) | You write it | Limited. Check the current docs. | Supported, with dense and sparse vectors |
| Storage on disk | One readable JSON file | Database files in a folder | Storage folder owned by the server |
| Official clients | Not applicable | Python, JS/TS, Rust | Python, JS/TS, Rust, Java, Go, C# |

## 2. Is Python required for ChromaDB?

No, with two limits.

- **Embedded mode** (no separate server) is Python only.
- **Client-server mode** needs a running Chroma server, and any client can talk to it. The server can be started with `npx chroma run --path ./db` (the npm package ships the CLI, per the Chroma getting-started page), or with Docker (`chromadb/chroma`, port 8000). Python is not needed for either.
- **Java:** I found no official Java client for Chroma. A Java program would call the server's REST API directly, or use a community client that I have not checked.
- **Embeddings are still your job outside Python and JS.** The Rust docs say the client expects embeddings to be passed in. A Java caller must produce embeddings itself, for example with an ONNX MiniLM model through a Java library, or a hosted embedding API.

For ServiceForge this does not matter. The memory tooling is separate from the Java backend (see `memory-architecture.md`, section 4). The assignment sheet says "node scripts", and Node 22 is installed here. So write the memory pipeline in Node and use the JS clients.

## 3. What is installed on this machine (checked 2026-11-17)

| Tool | State |
|---|---|
| Java | 17.0.2 |
| Node | v22.18.0 |
| Python | Not installed. `python` is only the Microsoft Store launcher. |
| Docker | Not installed. Podman 6.1.4 was installed later the same day and is used instead (see 4.0). |
| Current git branch | `main` |

Consequences:
- JSON: nothing to install.
- Chroma: the Node route works today, with no Python and no Docker.
- Qdrant: needs Docker, or Qdrant's standalone binary (I haven't verified a Windows build), or Python for its local mode. Docker Desktop is the common path on Windows.

## 4. Setup steps

Run all of these from `pipeline/memory/`. Never use port 8080 (the working agreement keeps it for the owner's dev server). Chroma defaults to port 8000. Qdrant uses 6333 and 6334.

### 4.0 Podman prerequisites (checked 2026-11-17)
- Podman 6.1.4 is installed at `%LOCALAPPDATA%\Programs\Podman` and works in the owner's terminal.
- Machine `podman-machine-default` (WSL) was running. `podman machine list` shows 8 CPUs, 2 GiB and 100 GiB, but those figures are not what the machine actually gets. Inside the machine (`podman machine ssh`) the checked values were 15.7 GB RAM and 16 CPUs, with a 1007 GB virtual disk of which 826 MB was used. With the WSL provider, CPU and memory come from WSL's global settings (`%USERPROFILE%\.wslconfig`, absent on this machine, so WSL defaults apply). `podman info` reported `rootless=false`, so the machine is rootful. Ports above 1024 work either way.
- Resources needed for this exercise (assistant's estimate, not vendor figures): about 1 GB of memory per container, 2 CPUs and under 1 GB of disk for a few dozen records. The current allocation is far above that, so no change is needed.
- To cap WSL resources, create `%USERPROFILE%\.wslconfig` with a `[wsl2]` section (for example `memory=4GB` and `processors=4`), then run `wsl --shutdown` and start the Podman machine again. The setting applies to every WSL distro, including Ubuntu, and the shutdown stops them.
- A terminal opened before the install may not have `podman` on its PATH. Open a new one.
- Use fully qualified image names (`docker.io/...`) so Podman does not prompt for a registry.
- Not run yet: no container has been started and no image pulled.

### 4.1 JSON store (baseline)
1. No install. Create `memory_pipeline/` and `memory_store.json` in B2.

### 4.2 ChromaDB through Node (no Python, no Docker)
1. In `pipeline/memory/memory_pipeline/`: `npm init -y`, then `npm install chromadb @chroma-core/default-embed`.
2. Start the server in a separate terminal: `npx chroma run --path ./chroma_data`. Keep it running.
3. Connect: `new ChromaClient()` (defaults to localhost:8000).
4. Create one collection per namespace, or one collection with a `namespace` metadata field. Store `feature`, `status`, `type_tag` and a numeric `ts` (epoch days or milliseconds) in the metadata, because range filters on dates are safest as numbers (to confirm in the docs).
5. Put the record `summary` in `documents` so Chroma embeds it. Query with `queryTexts` and a `where` filter for `status`, `feature` and `ts`.
6. The first embedding call downloads the default model. It needs internet once.

### 4.3 ChromaDB through Podman (alternative; the same commands work with Docker)
1. Confirm Podman is ready (see 4.0).
2. `podman pull docker.io/chromadb/chroma`.
3. `podman run -d --name chroma -p 8000:8000 -v chroma_data:/data docker.io/chromadb/chroma`. The `/data` path is the folder inside the container where Chroma keeps its database. Confirmed on Chroma's Docker docs page, which uses `-v ./chroma-data:/data`.
4. Steps 3 to 6 of 4.2 are the same. Stop with `podman stop chroma`; remove with `podman rm chroma`.

### 4.4 ChromaDB embedded in Python (alternative, not recommended here)
1. Install Python 3 from python.org (not the Store alias), create a venv, `pip install chromadb`.
2. Use `chromadb.PersistentClient(path="./chroma_data")`. It runs in the same process.
3. It adds a second language to the repo. Choose it only to learn the embedded mode.

### 4.5 Qdrant through Podman (the same commands work with Docker)
1. Confirm Podman is ready (see 4.0).
2. `podman pull docker.io/qdrant/qdrant`.
3. Start it with a named volume: `podman run -d --name qdrant -p 6333:6333 -p 6334:6334 -v qdrant_storage:/qdrant/storage docker.io/qdrant/qdrant`. The Qdrant quickstart uses a host folder (`$(pwd)/qdrant_storage`). A named volume avoids slow or permission-limited Windows folder mounts, but the data then lives inside the Podman machine, not in the repo. The REST API is on 6333, gRPC on 6334, and a web dashboard is at `http://localhost:6333/dashboard`. Stop with `podman stop qdrant`.
4. From Node: `npm install @qdrant/js-client-rest`, then `new QdrantClient({ host: "localhost", port: 6333 })`.
5. Create a collection with a fixed vector size that matches your embedding model (for example 384 for MiniLM-class models) and a distance metric (cosine).
6. Generate vectors yourself. In Node, `@chroma-core/default-embed` can supply the same MiniLM vectors, which keeps the comparison fair. Upsert each record as a point with the metadata as its payload, then search with a vector and a payload filter.

### 4.6 Qdrant from Java (only if you want the Java route)
1. Add `io.qdrant:client` to a Maven project. The client README showed 1.20.0 on 2026-11-17; check for the current version.
2. Connect over gRPC on 6334: `new QdrantClient(QdrantGrpcClient.newBuilder("localhost", 6334, false).build())`.
3. You still need embeddings. This is the main extra work in Java.

## 5. Experiment plan: same data, same checks, three stores

1. **Data:** the replay set from `memory-architecture.md`. Include both Feature 1 overlap rules (current and superseded), the 45-minute buffer, `booking-conflicts`, the `ApiError` contract, BUG-001 to BUG-004 summaries, and two or three decoy records in another namespace.
2. **Queries:** at least six.
   - Two that share keywords with the facts ("overlap check", "travel buffer").
   - Two paraphrases ("how much time must separate two jobs for one technician", "can a part be reserved for a job that is already booked").
   - One built to overflow the 500-token budget.
   - One from the decoy namespace.
3. **Run** each query against each store through the same `query(filters, text)` function. The budget code is shared, so only the retrieval differs.
4. **Record** for each store and query: records returned in order, whether the superseded rule appeared, namespace leakage, estimated tokens, and run time.
5. **Score** M-1 to M-9 per store. Add three learning columns: setup time, lines of code, and number of extra dependencies.
6. **Write up** one page: where each store won, where it lost, and whether any trigger in `adr-memory-store.md` ("Revisit when") was met.

## 6. What to watch for (common pitfalls)

- **Superseded records ranking first.** A vector store ranks by meaning, and the old rule says almost the same thing as the new one. Only the `status` filter stops it. Check this first.
- **Different embeddings between write and read.** Switching the embedding model without re-embedding the stored records gives poor or random results. Qdrant also rejects a vector of the wrong size.
- **Date filters.** Store dates as numbers (or the store's date type) and test the `as_of` boundary on the exact day.
- **Non-deterministic results.** Approximate search and model versions can reorder close scores. Compare the set of top results, not exact scores.
- **Port clashes and left-running servers.** Stop the Chroma and Qdrant servers when done. Do not use port 8080.
- **Committed data.** Add `chroma_data/` and `qdrant_storage/` to `.gitignore` before the first run, so binary stores are not staged.
