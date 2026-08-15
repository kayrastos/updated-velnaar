"""Official snapshot downloader for curated cyber knowledge sources."""

from __future__ import annotations

import shutil
import tempfile
from pathlib import Path
from typing import BinaryIO, Callable
from urllib.request import Request, urlopen
from zipfile import BadZipFile, ZipFile

CWE_LATEST_ZIP_URL = "https://cwe.mitre.org/data/xml/cwec_latest.xml.zip"
CAPEC_LATEST_ZIP_URL = "https://capec.mitre.org/data/archive/capec_latest.zip"

OFFICIAL_SNAPSHOT_URLS = {
    "cwe": CWE_LATEST_ZIP_URL,
    "capec": CAPEC_LATEST_ZIP_URL,
}

MAX_SNAPSHOT_BYTES = 128 * 1024 * 1024
USER_AGENT = "FulgorAI-Cyber-Ingest/1.1"


class CyberDownloadError(RuntimeError):
    pass


def _validate_zip(path: Path) -> None:
    try:
        with ZipFile(path) as archive:
            infos = [
                info for info in archive.infolist()
                if not info.is_dir() and info.filename.casefold().endswith(".xml")
            ]
            if len(infos) != 1:
                raise CyberDownloadError(
                    "snapshot arsivi tam olarak bir XML icerigi tasimali"
                )
            info = infos[0]
            if info.file_size <= 0 or info.file_size > MAX_SNAPSHOT_BYTES:
                raise CyberDownloadError("snapshot XML boyutu guvenli sinirin disinda")
            if ".." in Path(info.filename).parts or Path(info.filename).is_absolute():
                raise CyberDownloadError("snapshot arsiv yolu guvenli degil")
    except BadZipFile as exc:
        raise CyberDownloadError("snapshot gecerli bir ZIP arsivi degil") from exc


def download_official_snapshot(
    source: str,
    destination: str | Path,
    *,
    timeout_seconds: float = 30.0,
    opener: Callable[..., BinaryIO] = urlopen,
) -> Path:
    try:
        url = OFFICIAL_SNAPSHOT_URLS[source]
    except KeyError as exc:
        raise ValueError(f"indirilemeyen veya bilinmeyen cyber kaynagi: {source}") from exc

    destination_path = Path(destination)
    destination_path.parent.mkdir(parents=True, exist_ok=True)
    request = Request(
        url,
        headers={"Accept": "application/zip", "User-Agent": USER_AGENT},
        method="GET",
    )

    with tempfile.NamedTemporaryFile(
        prefix=f".{destination_path.name}.",
        suffix=".tmp",
        dir=destination_path.parent,
        delete=False,
    ) as temporary:
        temporary_path = Path(temporary.name)
        try:
            with opener(request, timeout=timeout_seconds) as response:
                content_length = response.headers.get("Content-Length")
                if content_length is not None and int(content_length) > MAX_SNAPSHOT_BYTES:
                    raise CyberDownloadError("snapshot HTTP boyutu guvenli siniri asiyor")

                copied = 0
                while True:
                    block = response.read(1024 * 1024)
                    if not block:
                        break
                    copied += len(block)
                    if copied > MAX_SNAPSHOT_BYTES:
                        raise CyberDownloadError("snapshot indirme boyutu guvenli siniri asiyor")
                    temporary.write(block)
                temporary.flush()
        except Exception:
            temporary_path.unlink(missing_ok=True)
            raise

    try:
        _validate_zip(temporary_path)
        shutil.move(str(temporary_path), str(destination_path))
    except Exception:
        temporary_path.unlink(missing_ok=True)
        raise

    return destination_path
