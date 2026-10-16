import json
from pydantic import BaseModel
from fastapi.responses import StreamingResponse
import re
import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="CodeCompass API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

GITHUB_API = "https://api.github.com"
OLLAMA_API = "http://localhost:11434/api/generate"
MODEL = "qwen2.5:3b"


@app.get("/")
async def home():
    return {"message": "CodeCompass API is running"}


def get_repo_coordinates(url: str):
    match = re.match(
        r"^https?://(?:www\.)?github\.com/([^/\s]+)/([^/\s]+)/?$",
        url.strip(),
    )

    if not match:
        raise HTTPException(
            status_code=400,
            detail="Enter a valid GitHub repository URL.",
        )

    owner = match.group(1)
    repo = match.group(2).removesuffix(".git")

    if not owner or not repo or repo in (".", ".."):
        raise HTTPException(
            status_code=400,
            detail="Invalid repository URL.",
        )

    return owner, repo


async def fetch_repo_data(url: str):
    owner, repo_name = get_repo_coordinates(url)
    base_url = f"{GITHUB_API}/repos/{owner}/{repo_name}"

    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "CodeCompass",
    }

    try:
        async with httpx.AsyncClient(
            timeout=20,
            follow_redirects=True,
            headers=headers,
        ) as client:
            response = await client.get(base_url)

            if response.status_code == 404:
                raise HTTPException(
                    status_code=404,
                    detail="Repository not found or not public.",
                )

            if response.status_code == 403:
                raise HTTPException(
                    status_code=403,
                    detail="GitHub API rate limit reached. Try again later.",
                )

            response.raise_for_status()
            metadata = response.json()
            default_branch = metadata.get("default_branch", "main")

            readme = ""
            readme_response = await client.get(f"{base_url}/readme")

            if readme_response.status_code == 200:
                readme_url = readme_response.json().get("download_url")

                if readme_url:
                    raw_response = await client.get(readme_url)
                    if raw_response.status_code == 200:
                        readme = raw_response.text[:12000]

            files = []
            tree_response = await client.get(
                f"{base_url}/git/trees/{default_branch}",
                params={"recursive": "1"},
            )

            if tree_response.status_code == 200:
                tree = tree_response.json().get("tree", [])
                files = [
                    item["path"]
                    for item in tree
                    if item.get("path")
                ][:100]

            issues = []
            issues_response = await client.get(
                f"{base_url}/issues",
                params={"state": "open", "per_page": 20},
            )

            if issues_response.status_code == 200:
                issues = [
                    {
                        "number": issue.get("number"),
                        "title": issue.get("title", ""),
                        "html_url": issue.get("html_url", ""),
                        "labels": [
                            label.get("name", "")
                            for label in issue.get("labels", [])
                        ],
                    }
                    for issue in issues_response.json()
                    if "pull_request" not in issue
                ][:10]

    except HTTPException:
        raise
    except httpx.TimeoutException:
        raise HTTPException(
            status_code=504,
            detail="GitHub took too long to respond. Try again.",
        )
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"GitHub returned HTTP {exc.response.status_code}.",
        )
    except httpx.RequestError:
        raise HTTPException(
            status_code=502,
            detail="Could not connect to GitHub. Check your internet.",
        )

    return {
        "name": metadata.get("full_name", f"{owner}/{repo_name}"),
        "description": metadata.get("description") or "",
        "url": metadata.get("html_url", url),
        "stars": metadata.get("stargazers_count", 0),
        "language": metadata.get("language"),
        "default_branch": default_branch,
        "readme": readme,
        "files": files,
        "issues": issues,
    }


@app.get("/analyze")
async def analyze_repo(url: str):
    return await fetch_repo_data(url)


@app.get("/guide")
async def generate_guide(url: str):
    # Get actual repository data first.
    repo = await fetch_repo_data(url)

    prompt = f"""
You are CodeCompass, an open-source onboarding assistant.

Create a concise guide for a beginner using this real repository data.

Repository: {repo["name"]}
Description: {repo["description"]}
Language: {repo["language"]}
Default branch: {repo["default_branch"]}

README:
{repo["readme"][:2500]}

Files:
{repo["files"][:35]}

Open issues:
{repo["issues"][:5]}

Write these five sections, using simple English:
1. Project purpose (two sentences)
2. Important files (up to five paths)
3. Setup instructions (use README information only)
4. How to test (only if supported by the README)
5. Three beginner contribution ideas

Keep the response concise, ideally under 350 words.
Never invent commands. Clearly label your own ideas as suggestions,
not as existing GitHub issues.
"""

    try:
        async with httpx.AsyncClient(timeout=180) as client:
            response = await client.post(
                OLLAMA_API,
                json={
                    "model": MODEL,
                    "prompt": prompt,
                    "stream": False,
                    "keep_alive": "10m",
                    "options": {
                        "temperature": 0.2,
                        "num_predict": 450,
                    },
                },
            )

            if response.status_code == 404:
                raise HTTPException(
                    status_code=503,
                    detail="Ollama model not found. Run: ollama pull qwen2.5:3b",
                )

            response.raise_for_status()
            result = response.json()

    except HTTPException:
        raise
    except httpx.ConnectError:
        raise HTTPException(
            status_code=503,
            detail="Ollama is not running. Start the Ollama service.",
        )
    except httpx.TimeoutException:
        raise HTTPException(
            status_code=504,
            detail="AI generation took too long. Try again.",
        )
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Ollama returned HTTP {exc.response.status_code}.",
        )
    except httpx.RequestError:
        raise HTTPException(
            status_code=503,
            detail="Could not communicate with Ollama.",
        )

    guide = result.get("response", "").strip()

    if not guide:
        raise HTTPException(
            status_code=502,
            detail="The AI returned an empty guide. Please retry.",
        )

    return {
        "repository": repo["name"],
        "guide": guide,
    }

class GuideStreamRequest(BaseModel):
    repo: dict


@app.post("/guide/stream")
async def guide_stream(payload: GuideStreamRequest):
    repo = payload.repo

    prompt = f"""
You are CodeCompass, a practical open-source onboarding assistant.

Repository: {repo.get("name", "Unknown")}
Description: {repo.get("description", "")}
Language: {repo.get("language", "Unknown")}
Default branch: {repo.get("default_branch", "Unknown")}

README:
{(repo.get("readme") or "")[:2500]}

Files:
{(repo.get("files") or [])[:35]}

Open issues:
{(repo.get("issues") or [])[:5]}

Create a concise beginner guide with these sections:
1. What this project does
2. Important files
3. Setup instructions based on the README
4. How to test, only if documented
5. Three suggested beginner contributions

Use simple English and Markdown. Stay under 350 words.
Never invent commands. Label suggested contributions as ideas.
"""

    async def generate():
        try:
            async with httpx.AsyncClient(timeout=None) as client:
                async with client.stream(
                    "POST",
                    OLLAMA_API,
                    json={
                        "model": MODEL,
                        "prompt": prompt,
                        "stream": True,
                        "keep_alive": -1,
                        "options": {
                            "temperature": 0.2,
                            "num_predict": 450,
                        },
                    },
                ) as response:
                    if response.status_code != 200:
                        yield json.dumps({
                            "error": f"Ollama returned HTTP {response.status_code}"
                        }) + "\n"
                        return

                    async for line in response.aiter_lines():
                        if line:
                            yield line + "\n"

        except Exception:
            yield json.dumps({
                "error": "Could not connect to Ollama. Check that it is running."
            }) + "\n"

    return StreamingResponse(
        generate(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache"},
    )

