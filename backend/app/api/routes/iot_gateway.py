"""
IoT Gateway — HTTP reverse proxy for ESP32 web servers running in QEMU.

When an ESP32 sketch starts a WebServer on port 80, QEMU's slirp
networking with hostfwd exposes it on a dynamic host port.  This
endpoint proxies HTTP requests from the browser to that host port,
enabling users to interact with their simulated ESP32 HTTP server.

URL pattern:
    /api/gateway/{client_id}/{path}
    →  http://127.0.0.1:{hostfwd_port}/{path}
"""
import json
import logging

import httpx
from fastapi import APIRouter, Request, Response

from app.core.hooks import iot_gateway_gate
from app.services.esp32_lib_manager import esp_lib_manager

router = APIRouter()
logger = logging.getLogger(__name__)


@router.api_route(
    '/{client_id}/{path:path}',
    methods=['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'],
)
async def gateway_proxy(client_id: str, path: str, request: Request) -> Response:
    """Reverse-proxy an HTTP request to the ESP32's web server."""
    # Plan gate (overlay-supplied). OSS image has no gate → allow everyone.
    # When the velxio-prod overlay is loaded, the gateway is a Maker+ feature;
    # free / anonymous callers get a 402 with an upgrade pointer.
    block_detail = await iot_gateway_gate(request)
    if block_detail is not None:
        # The frontend opens the gateway via window.open(_blank), so a raw
        # JSON 402 would dump in a new tab. Content-negotiate: serve a tiny
        # HTML upgrade page to browser navigations, JSON to programmatic
        # (fetch/XHR) callers.
        accepts_html = 'text/html' in (request.headers.get('accept') or '')
        upgrade_url = block_detail.get('upgrade_url', '/pricing')
        msg = block_detail.get('message', 'This is a paid feature.')
        if accepts_html:
            html = (
                '<!doctype html><html><head><meta charset="utf-8">'
                '<title>Velxio — upgrade required</title>'
                '<meta name="viewport" content="width=device-width, initial-scale=1">'
                '<style>body{background:#1e1e1e;color:#ddd;font-family:-apple-system,'
                'BlinkMacSystemFont,sans-serif;display:flex;min-height:100vh;margin:0;'
                'align-items:center;justify-content:center;text-align:center}'
                '.box{max-width:440px;padding:32px}h1{font-size:20px;color:#fff}'
                'p{color:#aaa;line-height:1.6}a{display:inline-block;margin-top:16px;'
                'background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;'
                'text-decoration:none;font-weight:600}</style></head><body><div class="box">'
                '<h1>IoT gateway is a Maker feature</h1>'
                f'<p>{msg} Upgrade to access live ESP32 web servers running in your '
                'simulated circuit.</p>'
                f'<a href="https://velxio.dev{upgrade_url}">See plans</a>'
                '</div></body></html>'
            )
            return Response(content=html, status_code=402, media_type='text/html')
        return Response(
            content=json.dumps({'error': 'pro_required', 'detail': block_detail}),
            status_code=402,
            media_type='application/json',
        )

    inst = esp_lib_manager.get_instance(client_id)
    if not inst or not inst.wifi_enabled or inst.wifi_hostfwd_port == 0:
        return Response(
            content='{"error":"No WiFi-enabled ESP32 instance found for this client"}',
            status_code=404,
            media_type='application/json',
        )

    target_url = f'http://127.0.0.1:{inst.wifi_hostfwd_port}/{path}'
    body = await request.body()

    # Forward relevant headers (skip hop-by-hop)
    skip_headers = {'host', 'transfer-encoding', 'connection'}
    headers = {
        k: v for k, v in request.headers.items()
        if k.lower() not in skip_headers
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.request(
                method=request.method,
                url=target_url,
                content=body,
                headers=headers,
            )
    except httpx.ConnectError:
        return Response(
            content='{"error":"ESP32 HTTP server is not responding. Make sure your sketch starts a WebServer on port 80."}',
            status_code=502,
            media_type='application/json',
        )
    except httpx.TimeoutException:
        return Response(
            content='{"error":"ESP32 HTTP server timed out"}',
            status_code=504,
            media_type='application/json',
        )

    # Forward response back to browser
    resp_headers = dict(resp.headers)
    # Remove hop-by-hop headers
    for h in ('transfer-encoding', 'connection', 'content-encoding'):
        resp_headers.pop(h, None)

    return Response(
        content=resp.content,
        status_code=resp.status_code,
        headers=resp_headers,
        media_type=resp.headers.get('content-type'),
    )
