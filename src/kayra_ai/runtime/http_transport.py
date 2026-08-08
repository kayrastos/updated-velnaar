from __future__ import annotations

import http.client
import socket
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Protocol
from urllib.parse import urlsplit

from .errors import ConnectionFailure, HTTPStatusFailure, MalformedResponseFailure, RequestTimeoutFailure


MAX_RESPONSE_BYTES = 2 * 1024 * 1024


@dataclass(frozen=True, slots=True)
class TransportResponse:
    status_code: int
    headers: Mapping[str, str]
    body: bytes


class HTTPTransport(Protocol):
    def request(
        self,
        *,
        method: str,
        url: str,
        headers: Mapping[str, str],
        body: bytes | None,
        connect_timeout_seconds: float,
        request_timeout_seconds: float,
    ) -> TransportResponse: ...


TransportFactory = Callable[[object], HTTPTransport]


class UrllibTransport:
    """Direct standard-library transport with no proxy or redirect behavior."""

    def request(
        self,
        *,
        method: str,
        url: str,
        headers: Mapping[str, str],
        body: bytes | None,
        connect_timeout_seconds: float,
        request_timeout_seconds: float,
    ) -> TransportResponse:
        parsed = urlsplit(url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise ConnectionFailure()
        connection_type = (
            http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
        )
        connection = connection_type(
            parsed.hostname,
            port=parsed.port,
            timeout=connect_timeout_seconds,
        )
        target = parsed.path or "/"
        if parsed.query:
            target = f"{target}?{parsed.query}"
        try:
            connection.request(method, target, body=body, headers=dict(headers))
            if connection.sock is not None:
                connection.sock.settimeout(request_timeout_seconds)
            response = connection.getresponse()
            if response.status < 200 or response.status >= 300:
                status_code = response.status
                response.close()
                raise HTTPStatusFailure(
                    status_code=status_code,
                    retryable=status_code == 429 or status_code >= 500,
                )
            payload = response.read(MAX_RESPONSE_BYTES + 1)
            if len(payload) > MAX_RESPONSE_BYTES:
                raise MalformedResponseFailure("Yerel çalışma zamanı yanıtı boyut sınırını aştı.")
            return TransportResponse(
                status_code=response.status,
                headers={key.lower(): value for key, value in response.getheaders()},
                body=payload,
            )
        except (socket.timeout, TimeoutError):
            raise RequestTimeoutFailure() from None
        except (MalformedResponseFailure, HTTPStatusFailure, RequestTimeoutFailure, ConnectionFailure):
            raise
        except http.client.HTTPException:
            raise MalformedResponseFailure() from None
        except OSError:
            raise ConnectionFailure() from None
        except Exception:
            raise ConnectionFailure() from None
        finally:
            connection.close()


def create_urllib_transport(network_config: object) -> HTTPTransport:
    # NetworkConfig validation guarantees proxy and redirect policy. Keeping the
    # argument in the factory makes those policies explicit for injected clients.
    _ = network_config
    return UrllibTransport()
