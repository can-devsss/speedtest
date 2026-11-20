import time
from pathlib import Path
from fastapi import FastAPI, Request, Query
from fastapi.responses import StreamingResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from speed_engine import (
    generate_download_stream,
    consume_upload_stream,
    resolve_network_info,
    enforce_bandwidth_quota,
)

app = FastAPI(title="Speedtest Engine", docs_url=None, redoc_url=None)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "HEAD", "OPTIONS"],
    allow_headers=["*"],
)

NO_CACHE_HEADERS = {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0",
}


@app.api_route("/api/ping", methods=["GET", "HEAD"])
async def ping_endpoint():
    return JSONResponse(
        content={"ts": time.time_ns()},
        headers=NO_CACHE_HEADERS,
    )


@app.get("/api/download")
async def download_endpoint(request: Request, size: int = Query(default=15, ge=1, le=25)):
    enforce_bandwidth_quota(request)
    headers = {
        **NO_CACHE_HEADERS,
        "Content-Type": "application/octet-stream",
        "Content-Disposition": "attachment; filename=speedtest.bin",
    }
    return StreamingResponse(
        generate_download_stream(size),
        headers=headers,
        media_type="application/octet-stream",
    )


@app.post("/api/upload")
async def upload_endpoint(request: Request):
    result = await consume_upload_stream(request)
    return JSONResponse(content=result, headers=NO_CACHE_HEADERS)


@app.get("/api/network-info")
async def network_info_endpoint(request: Request):
    info = await resolve_network_info(request)
    return JSONResponse(content=info, headers=NO_CACHE_HEADERS)


FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
if FRONTEND_DIR.exists():
    app.mount("/css", StaticFiles(directory=FRONTEND_DIR / "css"), name="css")
    app.mount("/js", StaticFiles(directory=FRONTEND_DIR / "js"), name="js")

    @app.get("/")
    async def serve_index():
        return FileResponse(FRONTEND_DIR / "index.html")