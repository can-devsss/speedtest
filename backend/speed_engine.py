import os
import time
import ipaddress
from collections import defaultdict
from typing import AsyncGenerator

import httpx
from fastapi import Request, HTTPException
from starlette.requests import ClientDisconnect

MB = 1024 * 1024
RANDOM_CHUNK_SIZE = 1 * MB  # 1 MB sikistirilamaz veri havuzu
RANDOM_BUFFER = os.urandom(RANDOM_CHUNK_SIZE)

MAX_DOWNLOAD_MB = 25          # tek istekte max indirme
MAX_UPLOAD_BYTES = 25 * MB    # tek istekte max yukleme

# Rate-limit onleyici GeoIP onbellegi (TTL: 10 dk)
_GEO_CACHE: dict[str, tuple[float, dict]] = {}
GEO_CACHE_TTL = 600

# Kredi / bant genisligi korumasi: ISTEK SAYISI yerine BAYT BUTCESI.
# Eski sinir (dakikada 14 istek) hizli hatlarda test ortasinda 429 uretiyordu.
# Ortam degiskeniyle ayarlanabilir: DOWNLOAD_BUDGET_MB / UPLOAD_BUDGET_MB
RATE_WINDOW_SEC = 60
DOWNLOAD_BUDGET_BYTES = int(os.getenv("DOWNLOAD_BUDGET_MB", "1500")) * MB
UPLOAD_BUDGET_BYTES = int(os.getenv("UPLOAD_BUDGET_MB", "800")) * MB

_USAGE: dict[tuple[str, str], list[tuple[float, int]]] = defaultdict(list)


def extract_client_ip(request: Request) -> str:
    # NOT: Proxy arkasinda degilseniz bu basliklar taklit edilebilir (limit asilabilir).
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()
    return request.client.host if request.client else "127.0.0.1"


def _window_usage(key: tuple[str, str], now: float) -> tuple[list[tuple[float, int]], int]:
    entries = [e for e in _USAGE[key] if now - e[0] < RATE_WINDOW_SEC]
    _USAGE[key] = entries
    return entries, sum(n for _, n in entries)


def _cleanup(now: float) -> None:
    if len(_USAGE) > 2048:
        stale = [k for k, v in _USAGE.items() if not v or now - v[-1][0] >= RATE_WINDOW_SEC]
        for k in stale:
            del _USAGE[k]


def _check_budget(kind: str, ip: str, budget: int, now: float) -> None:
    entries, used = _window_usage((kind, ip), now)
    if used >= budget:
        oldest = entries[0][0] if entries else now
        retry_after = max(1, int(RATE_WINDOW_SEC - (now - oldest)) + 1)
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded. Please wait before running another test.",
            headers={"Retry-After": str(retry_after)},
        )


def enforce_bandwidth_quota(request: Request) -> None:
    """Indirme istegi baslamadan once IP basina dakikalik bayt butcesini kontrol eder ve
    istenen boyutu butceye yazar (main.py degistirmeden calisir)."""
    now = time.time()
    ip = extract_client_ip(request)
    _check_budget("down", ip, DOWNLOAD_BUDGET_BYTES, now)

    try:
        size_mb = int(request.query_params.get("size", "15"))
    except ValueError:
        size_mb = 15
    size_mb = max(1, min(size_mb, MAX_DOWNLOAD_MB))

    _USAGE[("down", ip)].append((now, size_mb * MB))
    _cleanup(now)


async def generate_download_stream(size_mb: int) -> AsyncGenerator[bytes, None]:
    total_bytes = max(1, min(size_mb, MAX_DOWNLOAD_MB)) * MB
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
    ip = extract_client_ip(request)
    _check_budget("up", ip, UPLOAD_BUDGET_BYTES, time.time())

    start_time = time.perf_counter()
    total_bytes = 0

    try:
        async for chunk in request.stream():
            total_bytes += len(chunk)
            if total_bytes > MAX_UPLOAD_BYTES:
                raise HTTPException(status_code=413, detail="Payload exceeds limit.")
    except ClientDisconnect:
        # Istemci sure dolunca istegi iptal eder; bu bir hata degil, 500 uretmesin.
        pass
    finally:
        now = time.time()
        _USAGE[("up", ip)].append((now, total_bytes))
        _cleanup(now)

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
