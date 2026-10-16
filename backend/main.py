
import os
import re
import json
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field


# -------------------- CONFIGURATION --------------------

GITHUB_API = "https://api.github.com"
OLLAMA_API = os.getenv("OLLAMA_API", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:3b")

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


# -------------------- MODELS --------------------

class GuideRequest(BaseModel):
    owner: str = ""
    repo: str = ""
    question: str = "Explain this repository and how to get started."
    context: str = ""


class CreateRepoRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=350)
    private: bool = False


class CollaboratorRequest(BaseModel):
    owner: str = Field(min_length=1, max_length=100)
    repo: str = Field(min_length=1, max_length=100)
    username: str = Field(min_length=1, max_length=100)
    permission: str = "push"


# -------------------- HELPERS --------------------

def github_headers():
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "CodeCompass",
        "X-GitHub-Api-Version": "2022-11-28",
    }

    token = os.getenv("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"

    return headers


def get_repo_coordinates(url: str):
    parsed = urlparse(url.strip())

    if parsed.hostname not in ("github.com", "www.github.com"):
        raise HTTPException(
            status_code=400,
            detail="Please enter a valid GitHub repository URL.",
        )

    parts = [part for part in parsed.path.strip("/").split("/") if part]

    if len(parts) < 2:
        raise HTTPException(
            status_code=400,
            detail="Repository URL must include the owner and repository name.",
        )

    owner = parts[0]
    repo = parts[1].removesuffix(".git")

    if not re.fullmatch(r"[A-Za-z0-9-]+", owner):
        raise HTTPException(status_code=400, detail="Invalid GitHub owner.")

    if not re.fullmatch(r"[A-Za-z0-9._-]+", repo):
        raise HTTPException(status_code=400, detail="Invalid repository name.")

    return owner, repo


def github_error(response):
    try:
        data = response.json()
        message = data.get("message", response.text)
    except ValueError:
        message = response.text

    return str(message)


async def ollama_chat(messages, stream=False):
    try:
        async with httpx.AsyncClient(timeout=180) as client:
            response = await client.post(
                f"{OLLAMA_API}/api/chat",
                json={
                    "model": OLLAMA_MODEL,
                    "messages": messages,
                    "stream": stream,
                },
            )

            if response.status_code >= 400:
                raise HTTPException(
                    status_code=502,
                    detail=f"Ollama error: {response.text}",
                )

            return response

    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not connect to Ollama. Make sure Ollama is running "
                f"and model '{OLLAMA_MODEL}' is installed. Details: {exc}"
            ),
        )


# -------------------- HEALTH CHECK --------------------

@app.get("/")
async def home():
    return {
        "message": "CodeCompass API is running",
        "model": OLLAMA_MODEL,
    }


# -------------------- REPOSITORY ANALYZER --------------------

async def fetch_repo_data(url: str):
    owner, repo_name = get_repo_coordinates(url)
    base_url = f"{GITHUB_API}/repos/{owner}/{repo_name}"

    headers = github_headers()

    try:
        async with httpx.AsyncClient(
            timeout=25,
            follow_redirects=True,
            headers=headers,
        ) as client:

            repo_response = await client.get(base_url)

            if repo_response.status_code == 404:
                raise HTTPException(
                    status_code=404,
                    detail="Repository not found or you do not have access.",
                )

            if repo_response.status_code == 403:
                raise HTTPException(
                    status_code=403,
                    detail=(
                        "GitHub API rate limit reached or access denied. "
                        "Check your GITHUB_TOKEN and permissions."
                    ),
                )

            repo_response.raise_for_status()
            repo_data = repo_response.json()

            contents_response = await client.get(
                f"{base_url}/contents"
            )
            contents_response.raise_for_status()
            contents_data = contents_response.json()

            files = (
                contents_data
                if isinstance(contents_data, list)
                else []
            )

            issues_response = await client.get(
                f"{base_url}/issues",
                params={"state": "open", "per_page": 30},
            )

            issues = []
            if issues_response.status_code == 200:
                issues = [
                    issue
                    for issue in issues_response.json()
                    if "pull_request" not in issue
                ]

            readme = ""
            readme_response = await client.get(
                f"{base_url}/readme"
            )

            if readme_response.status_code == 200:
                readme_data = readme_response.json()
                download_url = readme_data.get("download_url")

                if download_url:
                    readme_text_response = await client.get(download_url)
                    if readme_text_response.status_code == 200:
                        readme = readme_text_response.text

            return {
                "owner": owner,
                "repo": repo_name,
                "repository": repo_data,
                "repo_data": repo_data,
                "files": files,
                "issues": issues,
                "readme": readme,
            }

    except HTTPException:
        raise

    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=exc.response.status_code,
            detail=f"GitHub API error: {github_error(exc.response)}",
        )

    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Could not connect to GitHub: {exc}",
        )


@app.get("/analyze")
async def analyze_repo(url: str):
    return await fetch_repo_data(url)


# -------------------- AI GETTING-STARTED GUIDE --------------------

@app.get("/guide")
async def guide(url: str, question: str = "Explain this repository"):
    repo_info = await fetch_repo_data(url)

    repo = repo_info["repository"]
    files = repo_info["files"]
    readme = repo_info["readme"]

    file_names = [
        item.get("path") or item.get("name", "")
        for item in files
    ]

    messages = [
        {
            "role": "system",
            "content": (
                "You are CodeCompass, a helpful open-source onboarding "
                "assistant. Explain code simply and accurately. Help "
                "beginners understand repository structure, setup, and "
                "contribution steps. Do not claim to have inspected files "
                "whose contents were not provided."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Repository: {repo.get('full_name')}\n"
                f"Description: {repo.get('description')}\n"
                f"Primary language: {repo.get('language')}\n"
                f"Default branch: {repo.get('default_branch')}\n"
                f"Root files: {json.dumps(file_names)}\n"
                f"README (truncated):\n{readme[:12000]}\n\n"
                f"User question: {question}"
            ),
        },
    ]

    response = await ollama_chat(messages)
    data = response.json()

    return {
        "guide": data.get("message", {}).get("content", ""),
        "response": data.get("message", {}).get("content", ""),
        "repository": repo_info,
    }


# -------------------- STREAMING AI GUIDE --------------------

@app.post("/guide/stream")
async def guide_stream(request: GuideRequest):
    owner = request.owner.strip()
    repo_name = request.repo.strip()

    repository_context = request.context

    if owner and repo_name:
        repository_context = (
            f"Repository: {owner}/{repo_name}\n"
            f"{repository_context}"
        )

    messages = [
        {
            "role": "system",
            "content": (
                "You are CodeCompass, an open-source onboarding assistant. "
                "Give practical, beginner-friendly answers. Use clear "
                "steps and explain commands. Do not invent repository "
                "details that are not included in the context."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Repository context:\n{repository_context[:16000]}\n\n"
                f"Question:\n{request.question}"
            ),
        },
    ]

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
                        error_text = await response.aread()
                        yield json.dumps({
                            "error": error_text.decode(
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

                        message = chunk.get("message", {})
                        content = message.get("content", "")

                        if content:
                            yield json.dumps({
                                "response": content,
                                "token": content,
                            }) + "\n"

                        if chunk.get("done"):
                            yield json.dumps({"done": True}) + "\n"

        except Exception as exc:
            yield json.dumps({"error": str(exc)}) + "\n"

    return StreamingResponse(
        generate(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache"},
    )


# -------------------- CREATE GITHUB REPOSITORY --------------------

@app.post("/github/repos")
async def create_github_repo(request: CreateRepoRequest):
    token = os.getenv("GITHUB_TOKEN")

    if not token:
        raise HTTPException(
            status_code=500,
            detail="GITHUB_TOKEN is missing. Start the backend with your GitHub CLI token.",
        )

    name = request.name.strip()

    if not re.fullmatch(r"[A-Za-z0-9._-]+", name):
        raise HTTPException(
            status_code=400,
            detail="Use only letters, numbers, dots, underscores, and hyphens in the repository name.",
        )

    payload = {
        "name": name,
        "description": request.description,
        "private": request.private,
        "auto_init": True,
    }

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                f"{GITHUB_API}/user/repos",
                headers=github_headers(),
                json=payload,
            )

            if response.status_code not in (200, 201):
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"Could not create repository: {github_error(response)}",
                )

            data = response.json()

            return {
                "success": True,
                "message": "Repository created successfully.",
                "name": data.get("name"),
                "full_name": data.get("full_name"),
                "html_url": data.get("html_url"),
                "clone_url": data.get("clone_url"),
                "private": data.get("private"),
                "default_branch": data.get("default_branch"),
            }

    except HTTPException:
        raise

    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Could not connect to GitHub: {exc}",
        )


# -------------------- ADD GITHUB COLLABORATOR --------------------

@app.post("/github/collaborators")
async def add_collaborator(request: CollaboratorRequest):
    if not os.getenv("GITHUB_TOKEN"):
        raise HTTPException(
            status_code=500,
            detail="GITHUB_TOKEN is missing. Restart the backend with your GitHub CLI token.",
        )

    owner = request.owner.strip()
    repo = request.repo.strip()
    username = request.username.strip()
    permission = request.permission.strip().lower()

    if not re.fullmatch(r"[A-Za-z0-9-]+", owner):
        raise HTTPException(status_code=400, detail="Invalid repository owner.")

    if not re.fullmatch(r"[A-Za-z0-9._-]+", repo):
        raise HTTPException(status_code=400, detail="Invalid repository name.")

    if not re.fullmatch(r"[A-Za-z0-9-]+", username):
        raise HTTPException(status_code=400, detail="Invalid GitHub username.")

    allowed_permissions = {
        "pull",
        "triage",
        "push",
        "maintain",
        "admin",
    }

    if permission not in allowed_permissions:
        raise HTTPException(
            status_code=400,
            detail="Invalid permission. Choose pull, triage, push, maintain, or admin.",
        )

    url = (
        f"{GITHUB_API}/repos/{owner}/{repo}"
        f"/collaborators/{username}"
    )

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.put(
                url,
                headers=github_headers(),
                json={"permission": permission},
            )

            if response.status_code not in (201, 204):
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"GitHub could not add the collaborator: {github_error(response)}",
                )

            return {
                "success": True,
                "message": (
                    f"Invitation sent to {username} for {owner}/{repo}."
                ),
                "username": username,
                "repository": f"{owner}/{repo}",
                "permission": permission,
                "invitation_url": (
                    f"https://github.com/{owner}/{repo}/settings/access"
                ),
            }

    except HTTPException:
        raise

    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Could not connect to GitHub: {exc}",
        )
