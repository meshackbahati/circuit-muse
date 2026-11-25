"""Same-origin relay for the NVIDIA NIM API.

The desktop WebView treats every request to ``integrate.api.nvidia.com`` as
cross-origin, and NVIDIA sends no ``Access-Control-Allow-Origin`` header, so a
direct fetch from the bundle fails with a bare ``Load failed`` before the
request reaches the service. The relay is limited to NVIDIA on purpose: other
providers answer preflight correctly and are called directly. Destination
validation keeps this route from becoming an open proxy.
"""

from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import Response, StreamingResponse

router = APIRouter(prefix="/api/ai/nvidia", tags=["ai-proxy"])

ALLOWED_HOST = "integrate.api.nvidia.com"
# A stalled build can legitimately take minutes; the read window still has to
# end so a dropped upstream does not pin the request forever.
CHAT_TIMEOUT = httpx.Timeout(connect=20.0, read=300.0, write=30.0, pool=20.0)
MODELS_TIMEOUT = httpx.Timeout(connect=20.0, read=30.0, write=30.0, pool=20.0)


def _checked_url(raw: object) -> str | None:
    if not isinstance(raw, str) or not raw:
        return None
    parts = urlsplit(raw)
    if parts.scheme != "https" or parts.hostname != ALLOWED_HOST:
        return None
    if not parts.path.startswith("/v1/"):
        return None
    return raw


def _error(status: int, message: str) -> Response:
    return Response(
        content='{"detail":"%s"}' % message.replace('"', "'"),
        status_code=status,
        media_type="application/json",
    )


@router.post("/models")
async def proxy_models(request: Request):
    data = await request.json()
    url = _checked_url(data.get("url"))
    if url is None:
        return _error(400, f"url must target https://{ALLOWED_HOST}/v1/")
    api_key = data.get("api_key", "")
    try:
        async with httpx.AsyncClient(timeout=MODELS_TIMEOUT) as client:
            upstream = await client.get(
                url,
                headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"},
            )
    except Exception as exc:
        return _error(502, str(exc))
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        media_type=upstream.headers.get("content-type", "application/json"),
    )


@router.post("/chat")
async def proxy_chat(request: Request):
    data = await request.json()
    url = _checked_url(data.get("url"))
    body = data.get("body")
    if url is None:
        return _error(400, f"url must target https://{ALLOWED_HOST}/v1/")
    if body is None:
        return _error(400, "body is required")
    api_key = data.get("api_key", "")
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
    }

    client = httpx.AsyncClient(timeout=CHAT_TIMEOUT)
    try:
        upstream = await client.send(
            client.build_request("POST", url, headers=headers, json=body),
            stream=True,
        )
    except Exception as exc:
        await client.aclose()
        return _error(502, str(exc))

    if upstream.status_code >= 400:
        content = await upstream.aread()
        await upstream.aclose()
        await client.aclose()
        return Response(
            content=content,
            status_code=upstream.status_code,
            media_type=upstream.headers.get("content-type", "application/json"),
        )

    async def stream():
        try:
            async for chunk in upstream.aiter_bytes():
                yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    return StreamingResponse(
        stream(),
        status_code=upstream.status_code,
        media_type=upstream.headers.get("content-type", "text/event-stream"),
    )
