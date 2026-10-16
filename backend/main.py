import os
import json
import base64
from typing import Optional

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field


app = FastAPI(title="CodeCompass API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

GITHUB_API = "https://api.github.com"
OLLAMA_API = os.getenv("OLLAMA_API", "http://127.0.0.1:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:3b")


# -------------------- Request models --------------------

class GuideRequest(BaseModel):
    owner: str
    repo: str
    question: str = (
        "Explain this repository, its important files, how to run it, "
        "and how a beginner can contribute."
    )
    context: str = ""


class CreateRepoRequest(BaseModel):
    name: str
    description: str = ""
    private: bool = False
    auto_init: bool = True


class CollaboratorRequest(BaseModel):
    owner: str
    repo: str
    username: str
    permission: str = "push"


# -------------------- GitHub helpers --------------------

def github_headers():
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }

    token = os.getenv("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"

    return headers


def github_error(response):
    try:
        return response.json().get("message", response.text)
    except Exception:
        return response.text


def validate_name(value, label):
    value = value.strip()
    if not value:
        raise HTTPException(status_code=400, detail=f"{label} is required.")
    if "/" in value:
        raise HTTPException(
            status_code=400,
            detail=f"{label} must not contain '/'.",
        )
    return value


async def github_get(url, params=None):
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.get(
            url,
            headers=github_headers(),
            params=params,
        )

    if response.status_code >= 400:
        raise HTTPException(
            status_code=response.status_code,
            detail=f"GitHub API error: {github_error(response)}",
        )

    return response.json()


async def fetch_repo_data(owner, repo):
    owner = validate_name(owner, "Owner")
    repo = validate_name(repo, "Repository")

    repo_data = await github_get(
        f"{GITHUB_API}/repos/{owner}/{repo}"
    )

    tree_data = await github_get(
        f"{GITHUB_API}/repos/{owner}/{repo}/git/trees/"
        f"{repo_data.get('default_branch', 'main')}",
        params={"recursive": "1"},
    )

    files = [
        {
            "path": item.get("path", ""),
            "type": item.get("type", ""),
            "size": item.get("size", 0),
        }
        for item in tree_data.get("tree", [])
        if item.get("type") == "blob"
    ]

    readme = ""
    try:
        readme_data = await github_get(
            f"{GITHUB_API}/repos/{owner}/{repo}/readme"
        )
        if readme_data.get("encoding") == "base64":
            readme = base64.b64decode(
                readme_data["content"]
            ).decode("utf-8", errors="replace")
    except HTTPException:
        # A repository may not contain a README.
        pass

    return {
        "owner": owner,
        "repo": repo,
        "url": repo_data.get("html_url", ""),
        "repository": repo_data,
        "files": files,
        "readme": readme,
    }





import re
import asyncio

def architecture_language(path):
    ext = path.rsplit(".", 1)[-1].lower() if "." in path else ""
    return {
        "py": "Python", "js": "JavaScript", "jsx": "React JSX",
        "ts": "TypeScript", "tsx": "React TSX", "css": "CSS",
        "html": "HTML", "json": "JSON", "md": "Markdown",
        "java": "Java", "go": "Go", "rs": "Rust",
        "c": "C", "cpp": "C++", "sql": "SQL",
    }.get(ext, "Other")


def architecture_purpose(path):
    name = path.lower().split("/")[-1]
    if name in {"main.py", "app.py", "server.py"}:
        return "Possible backend entry point."
    if name in {"app.jsx", "app.tsx", "app.js", "app.ts"}:
        return "Possible main frontend component."
    if name in {"package.json", "requirements.txt", "pyproject.toml"}:
        return "Project dependencies and configuration."
    if name.startswith("readme"):
        return "Project documentation."
    if name.endswith(".css"):
        return "Visual styles and layout."
    if name.endswith((".jsx", ".tsx", ".html")):
        return "Frontend interface or markup."
    if name.endswith(".py"):
        return "Python source module."
    return "Source or configuration file."


def resolve_import(source, specifier, known):
    if not specifier.startswith("."):
        return None
    import posixpath
    base = posixpath.normpath(
        posixpath.join(posixpath.dirname(source), specifier)
    )
    candidates = [
        base, base + ".js", base + ".jsx", base + ".ts",
        base + ".tsx", base + ".py", base + ".css",
        base + ".json",
        posixpath.join(base, "index.js"),
        posixpath.join(base, "index.jsx"),
        posixpath.join(base, "index.ts"),
        posixpath.join(base, "index.tsx"),
    ]
    return next((item for item in candidates if item in known), None)


@app.get("/architecture")
async def repository_architecture(owner: str, repo: str):
    data = await fetch_repo_data(owner, repo)
    files = data.get("files", [])
    branch = data.get("repository", {}).get("default_branch", "main")
    paths = [
        item["path"] for item in files
        if item.get("path", "").lower().endswith(
            (".py", ".js", ".jsx", ".ts", ".tsx", ".css",
             ".html", ".java", ".go", ".rs")
        )
        and not any(part in {
            "node_modules", ".git", "dist", "build", ".venv", "vendor"
        } for part in item.get("path", "").split("/"))
    ][:100]

    contents = {}
    semaphore = asyncio.Semaphore(10)

    async def fetch_source(client, path):
        async with semaphore:
            url = f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}"
            try:
                response = await client.get(url)
                if response.status_code == 200:
                    contents[path] = response.text[:16000]
            except httpx.HTTPError:
                pass

    async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
        await asyncio.gather(
            *(fetch_source(client, path) for path in paths)
        )

    known = set(paths)
    nodes = []
    edges = []
    seen = set()

    for path in paths:
        nodes.append({
            "id": path,
            "label": path.split("/")[-1],
            "path": path,
            "language": architecture_language(path),
            "purpose": architecture_purpose(path),
            "size": len(contents.get(path, "")),
            "url": f"https://github.com/{owner}/{repo}/blob/{branch}/{path}",
        })

    patterns = [
        r"(?m)^\s*import\s+.*?\s+from\s+['\"]([^'\"]+)['\"]",
        r"(?m)^\s*import\s+['\"]([^'\"]+)['\"]",
        r"(?m)^\s*export\s+.*?\s+from\s+['\"]([^'\"]+)['\"]",
        r"(?m)^\s*(?:const|let|var)\s+.*?=\s*require\(['\"]([^'\"]+)['\"]\)",
    ]

    for source, content in contents.items():
        for pattern in patterns:
            for match in re.finditer(pattern, content):
                target = resolve_import(source, match.group(1), known)
                if target and target != source and (source, target) not in seen:
                    seen.add((source, target))
                    edges.append({
                        "id": source + "->" + target,
                        "source": source,
                        "target": target,
                        "kind": "dependency",
                        "label": "imports",
                    })

    return {
        "owner": owner,
        "repo": repo,
        "url": data.get("url", ""),
        "branch": branch,
        "nodes": nodes,
        "edges": edges,
        "total_files": len(files),
        "inspected_files": len(contents),
        "truncated": len(paths) < len(files),
    }


@app.post("/architecture/explain")
async def explain_architecture_file(payload: dict):
    owner = validate_name(str(payload.get("owner", "")), "Owner")
    repo = validate_name(str(payload.get("repo", "")), "Repository")
    path = str(payload.get("path", "")).strip()

    if not path or path.startswith("/") or ".." in path.split("/"):
        raise HTTPException(status_code=400, detail="Invalid file path.")

    metadata = await github_get(f"{GITHUB_API}/repos/{owner}/{repo}")
    branch = metadata.get("default_branch", "main")
    url = f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}"

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(url)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Could not retrieve source file.") from exc

    if response.status_code != 200:
        raise HTTPException(status_code=404, detail="Could not retrieve source file.")

    language = architecture_language(path)
    prompt = (
        "Explain this source file to a beginner. Use headings PURPOSE, "
        "HOW IT WORKS, and IMPORTANT DETAILS. Be specific and do not invent behavior.\n"
        f"Repository: {owner}/{repo}\nPath: {path}\nLanguage: {language}\n"
        f"Source code:\n{response.text[:8000]}"
    )

    try:
        async with httpx.AsyncClient(timeout=90) as client:
            result = await client.post(
                f"{OLLAMA_API}/api/generate",
                json={
                    "model": OLLAMA_MODEL,
                    "prompt": prompt,
                    "stream": False,
                    "options": {"num_predict": 220, "temperature": 0.2},
                },
            )
        if result.status_code >= 400:
            raise HTTPException(status_code=502, detail="Ollama could not explain this file.")
        explanation = result.json().get("response", "").strip()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Could not connect to Ollama.") from exc

    return {
        "path": path,
        "language": language,
        "purpose": architecture_purpose(path),
        "explanation": explanation or "No explanation returned.",
    }


# -------------------- Source code retrieval --------------------

IGNORED_DIRECTORIES = {
    "node_modules", ".git", "dist", "build", "coverage",
    ".venv", "venv", "__pycache__", ".next", "vendor",
}

SOURCE_EXTENSIONS = (
    ".py", ".js", ".jsx", ".ts", ".tsx", ".html", ".css",
    ".json", ".md", ".yml", ".yaml", ".toml", ".sh",
    ".sql", ".java", ".c", ".cpp", ".h", ".go", ".rs",
)

PRIORITY_FILES = {
    "readme.md", "package.json", "main.py", "app.py",
    "app.jsx", "app.js", "main.jsx", "main.js",
    "requirements.txt", "pyproject.toml", "dockerfile",
}


async def fetch_source_context(owner, repo):
    owner = validate_name(owner, "Owner")
    repo = validate_name(repo, "Repository")

    base_url = f"{GITHUB_API}/repos/{owner}/{repo}"

    async with httpx.AsyncClient(
        timeout=30,
        headers=github_headers(),
        follow_redirects=True,
    ) as client:
        repo_response = await client.get(base_url)

        if repo_response.status_code >= 400:
            raise HTTPException(
                status_code=repo_response.status_code,
                detail=f"GitHub error: {github_error(repo_response)}",
            )

        repo_data = repo_response.json()
        branch = repo_data.get("default_branch", "main")

        tree_response = await client.get(
            f"{base_url}/git/trees/{branch}",
            params={"recursive": "1"},
        )

        if tree_response.status_code >= 400:
            raise HTTPException(
                status_code=502,
                detail=f"Could not retrieve repository tree: "
                       f"{github_error(tree_response)}",
            )

        tree_data = tree_response.json()
        candidates = []

        for item in tree_data.get("tree", []):
            path = item.get("path", "")
            lower_path = path.lower()
            parts = lower_path.split("/")
            filename = parts[-1]

            if item.get("type") != "blob":
                continue

            if any(part in IGNORED_DIRECTORIES for part in parts):
                continue

            if not filename.endswith(SOURCE_EXTENSIONS):
                continue

            if item.get("size", 0) > 20000:
                continue

            score = 0

            if filename in PRIORITY_FILES:
                score += 10

            if filename.startswith("readme"):
                score += 8

            if filename in {
                "main.py", "app.py", "app.jsx", "app.js",
                "main.jsx", "main.js",
            }:
                score += 5

            if any(
                part in {"src", "backend", "frontend"}
                for part in parts[:-1]
            ):
                score += 3

            # Extra priority for CodeCompass's known main files.
            if lower_path == "backend/main.py":
                score += 100
            elif lower_path == "frontend/src/app.jsx":
                score += 100

            candidates.append((score, item))

        candidates.sort(key=lambda entry: entry[0], reverse=True)

        source_files = []
        total_chars = 0
        max_files = 12
        max_chars = 28000

        for _, item in candidates:
            if len(source_files) >= max_files:
                break
            if total_chars >= max_chars:
                break

            blob_response = await client.get(
                f"{GITHUB_API}/repos/{owner}/{repo}"
                f"/git/blobs/{item['sha']}"
            )

            if blob_response.status_code != 200:
                continue

            blob = blob_response.json()

            if blob.get("encoding") != "base64":
                continue

            try:
                content = base64.b64decode(
                    blob["content"]
                ).decode("utf-8", errors="replace")
            except (ValueError, KeyError):
                continue

            remaining = max_chars - total_chars
            content = content[:remaining]

            source_files.append(
                f"\n--- FILE: {item['path']} ---\n"
                f"{content}\n"
            )
            total_chars += len(content)

        if not source_files:
            raise HTTPException(
                status_code=422,
                detail="No readable source files were found.",
            )

    project_context = (
        f"Repository: {repo_data.get('full_name')}\n"
        f"Description: {repo_data.get('description')}\n"
        f"Primary language: {repo_data.get('language')}\n"
        f"Default branch: {branch}\n"
        f"Files inspected: {len(source_files)}\n"
        + "\n".join(source_files)
    )

    return project_context, [item.split("\n")[1] for item in source_files]


# -------------------- Ollama helpers --------------------

def build_messages(request, project_context):
    system_prompt = """
You are CodeCompass, a precise codebase onboarding assistant.

You are given actual source code. Explain the implementation that is
actually present, not a generic application architecture.

Rules:
- Only claim a function, variable, component, endpoint, or dependency
  exists if it appears in the supplied source.
- Name exact filenames and actual function names.
- Explain actual React state variables and event handlers when present.
- Explain actual FastAPI routes and how frontend requests connect to them.
- Describe actual request bodies and response fields when visible.
- Never claim App.jsx uses createRoot or StrictMode unless that code
  appears in the supplied App.jsx source.
- Do not invent commands, features, files, or integrations.
- If a requested detail is missing, say it cannot be confirmed.
- Clearly separate confirmed facts from suggestions.
- Be specific, practical, and beginner-friendly.
"""

    user_prompt = f"""
Analyze this repository using the source code below.

Repository: {request.owner}/{request.repo}
Question: {request.question}

Additional user context:
{request.context or "(none supplied)"}

Give the answer in these sections:
1. What the project actually does
2. Important files and their responsibilities
3. Verified functions, React state, and event handlers
4. Backend routes and frontend-to-backend connections
5. How to run it, only where supported by the files
6. Beginner-friendly contribution ideas

For every important implementation claim, mention the filename and
the relevant function or variable. Do not substitute generic React
setup explanations for the supplied application's actual logic.

SOURCE CODE:
{project_context}
"""

    return [
        {"role": "system", "content": system_prompt.strip()},
        {"role": "user", "content": user_prompt.strip()},
    ]


async def ollama_generate(messages):
    async with httpx.AsyncClient(timeout=180) as client:
        response = await client.post(
            f"{OLLAMA_API}/api/chat",
            json={
                "model": OLLAMA_MODEL,
                "messages": messages,
                "stream": False,
            },
        )

    if response.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail=f"Ollama error: {response.text}",
        )

    return response.json().get("message", {}).get("content", "")


# -------------------- Basic and analysis routes --------------------

@app.get("/")
async def health():
    return {
        "status": "running",
        "service": "CodeCompass API",
        "model": OLLAMA_MODEL,
    }


@app.get("/analyze")
async def analyze(owner: str, repo: str):
    return await fetch_repo_data(owner, repo)


# -------------------- AI onboarding routes --------------------

@app.post("/guide")
async def guide(request: GuideRequest):
    project_context, inspected_files = await fetch_source_context(
        request.owner, request.repo
    )

    messages = build_messages(request, project_context)
    answer = await ollama_generate(messages)

    return {
        "guide": answer,
        "response": answer,
        "files_inspected": inspected_files,
    }


@app.post("/guide/stream")
async def guide_stream(request: GuideRequest):
    project_context, inspected_files = await fetch_source_context(
        request.owner, request.repo
    )

    messages = build_messages(request, project_context)

    async def generate():
        try:
            async with httpx.AsyncClient(timeout=None) as client:
                async with client.stream(
                    "POST",
                    f"{OLLAMA_API}/api/chat",
                    json={
                        "model": OLLAMA_MODEL,
                        "messages": messages,
                        "stream": True,
                    },
                    timeout=180,
                ) as response:

                    if response.status_code >= 400:
                        error_body = await response.aread()
                        yield json.dumps({
                            "error": error_body.decode(
                                "utf-8", errors="replace"
                            )
                        }) + "\n"
                        return

                    async for line in response.aiter_lines():
                        if not line:
                            continue

                        try:
                            chunk = json.loads(line)
                        except json.JSONDecodeError:
                            continue

                        content = chunk.get(
                            "message", {}
                        ).get("content", "")

                        if content:
                            yield json.dumps({
                                "response": content,
                                "token": content,
                            }) + "\n"

                        if chunk.get("done"):
                            yield json.dumps({
                                "done": True,
                                "files_inspected": inspected_files,
                            }) + "\n"

        except Exception as exc:
            yield json.dumps({"error": str(exc)}) + "\n"

    return StreamingResponse(
        generate(),
        media_type="application/x-ndjson",
    )


# -------------------- GitHub repository creation --------------------

@app.post("/github/repos")
async def create_github_repo(request: CreateRepoRequest):
    token = os.getenv("GITHUB_TOKEN")
    if not token:
        raise HTTPException(
            status_code=401,
            detail="GITHUB_TOKEN is not set in the backend environment.",
        )

    name = validate_name(request.name, "Repository name")

    payload = {
        "name": name,
        "description": request.description,
        "private": request.private,
        "auto_init": request.auto_init,
    }

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            f"{GITHUB_API}/user/repos",
            headers=github_headers(),
            json=payload,
        )

    if response.status_code >= 400:
        raise HTTPException(
            status_code=response.status_code,
            detail=f"GitHub error: {github_error(response)}",
        )

    return response.json()


# -------------------- Collaborator invitations --------------------

@app.post("/github/collaborators")
async def add_collaborator(request: CollaboratorRequest):
    if not os.getenv("GITHUB_TOKEN"):
        raise HTTPException(
            status_code=401,
            detail="GITHUB_TOKEN is not set in the backend environment.",
        )

    owner = validate_name(request.owner, "Owner")
    repo = validate_name(request.repo, "Repository")
    username = validate_name(request.username, "Username")

    allowed_permissions = {"pull", "triage", "push", "maintain", "admin"}
    permission = request.permission.lower().strip()

    if permission not in allowed_permissions:
        raise HTTPException(
            status_code=400,
            detail="Permission must be pull, triage, push, maintain, or admin.",
        )

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.put(
            f"{GITHUB_API}/repos/{owner}/{repo}"
            f"/collaborators/{username}",
            headers=github_headers(),
            json={"permission": permission},
        )

    if response.status_code >= 400:
        raise HTTPException(
            status_code=response.status_code,
            detail=f"GitHub error: {github_error(response)}",
        )

    if response.status_code == 204:
        return {
            "success": True,
            "message": f"Invitation or collaborator update sent to {username}.",
            "owner": owner,
            "repo": repo,
            "username": username,
            "permission": permission,
        }

    return {
        "success": True,
        "message": f"GitHub processed the collaborator request for {username}.",
        "owner": owner,
        "repo": repo,
        "username": username,
        "permission": permission,
        "github_response": response.json(),
    }
