import os
import time
import ipaddress
from collections import defaultdict
from typing import AsyncGenerator
import httpx
from fastapi import Request, HTTPException

RANDOM_CHUNK_SIZE = 1024 * 1024  # 1 MB sikistirilamaz veri havuzu
RANDOM_BUFFER = os.urandom(RANDOM_CHUNK_SIZE)

# Rate-limit onleyici GeoIP onbellegi (TTL: 10 dk)
_GEO_CACHE: dict[str, tuple[float, dict]] = {}
GEO_CACHE_TTL = 600

# Kredi ve bant genisligi korumasi: IP basina dakikada max 2 tam test (14 stream istegi)
_RATE_LOG: dict[str, list[float]] = defaultdict(list)
RATE_WINDOW_SEC = 60
MAX_STREAM_REQUESTS_PER_WINDOW = 14


def extract_client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()
    return request.client.host if request.client else "127.0.0.1"


def enforce_bandwidth_quota(request: Request) -> None:
    """Ayni IP'nin krediyi tuketmesini onlemek icin dakikadaki test sayisini sinirlar."""
    ip = extract_client_ip(request)
    now = time.time()

    timestamps = [t for t in _RATE_LOG[ip] if now - t < RATE_WINDOW_SEC]
    if len(timestamps) >= MAX_STREAM_REQUESTS_PER_WINDOW:
        _RATE_LOG[ip] = timestamps
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded. Please wait 60 seconds before running another test.",
        )

    timestamps.append(now)
    _RATE_LOG[ip] = timestamps

    # Bellek sismanlamasini onlemek icin periyodik temizlik
    if len(_RATE_LOG) > 1024:
        stale_ips = [k for k, v in _RATE_LOG.items() if not v or (now - v[-1] > RATE_WINDOW_SEC)]
        for k in stale_ips:
            del _RATE_LOG[k]


async def generate_download_stream(size_mb: int) -> AsyncGenerator[bytes, None]:
    # Tek istekte maksimum 25 MB ile sinirlandirildi
    total_bytes = max(1, min(size_mb, 25)) * 1024 * 1024
    bytes_sent = 0

    while bytes_sent < total_bytes:
        remaining = total_bytes - bytes_sent
        if remaining >= RANDOM_CHUNK_SIZE:
            yield RANDOM_BUFFER
            bytes_sent += RANDOM_CHUNK_SIZE
        else:
            yield RANDOM_BUFFER[:remaining]
            bytes_sent += remaining


async def consume_upload_stream(request: Request) -> dict:
    start_time = time.perf_counter()
    total_bytes = 0
    max_upload_bytes = 25 * 1024 * 1024  # Tek istekte max 25 MB koruma

    async for chunk in request.stream():
        total_bytes += len(chunk)
        if total_bytes > max_upload_bytes:
            raise HTTPException(status_code=413, detail="Payload exceeds limit.")

    elapsed = max(time.perf_counter() - start_time, 0.0001)
    mbps = (total_bytes * 8) / (elapsed * 1_000_000)

    return {
        "bytes_received": total_bytes,
        "duration_sec": round(elapsed, 4),
        "server_mbps": round(mbps, 2),
    }


async def resolve_network_info(request: Request) -> dict:
    ip_str = extract_client_ip(request)
    ip_version = "IPv6" if ":" in ip_str else "IPv4"

    try:
        ip_obj = ipaddress.ip_address(ip_str)
        is_private = ip_obj.is_private or ip_obj.is_loopback
    except ValueError:
        is_private = True

    if is_private:
        return {
            "ip_masked": "127.0.0.1 (Local)",
            "ip_version": ip_version,
            "isp": "Local Loopback",
            "asn": "AS0000",
            "city": "Localhost",
            "country": "TR",
        }

    now = time.time()
    cached = _GEO_CACHE.get(ip_str)
    if cached and (now - cached[0] < GEO_CACHE_TTL):
        return cached[1]

    parts = ip_str.split(".")
    masked_ip = f"{parts[0]}.{parts[1]}.xxx.xxx" if len(parts) == 4 else "IPv6 Masked"

    result = {
        "ip_masked": masked_ip,
        "ip_version": ip_version,
        "isp": "Detected Network",
        "asn": "-",
        "city": "-",
        "country": "-",
    }

    try:
        async with httpx.AsyncClient(timeout=2.5) as client:
            resp = await client.get(
                f"http://ip-api.com/json/{ip_str}?fields=status,countryCode,city,isp,as"
            )
            data = resp.json()
            if data.get("status") == "success":
                as_raw = data.get("as", "")
                asn = as_raw.split(" ")[0] if as_raw else "-"
                result = {
                    "ip_masked": masked_ip,
                    "ip_version": ip_version,
                    "isp": data.get("isp", "Unknown ISP"),
                    "asn": asn,
                    "city": data.get("city", "-"),
                    "country": data.get("countryCode", "-"),
                }
    except Exception:
        pass

    if len(_GEO_CACHE) >= 256:
        _GEO_CACHE.clear()
    _GEO_CACHE[ip_str] = (now, result)
    return result