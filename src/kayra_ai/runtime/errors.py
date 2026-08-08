from __future__ import annotations

from .contracts import BackendErrorInfo, ErrorKind


class RuntimeFailure(Exception):
    """A typed runtime failure whose public text is safe to log or persist."""

    kind: ErrorKind = "internal"
    default_message = "Çalışma zamanı hatası oluştu."
    retryable = False

    def __init__(
        self,
        message: str | None = None,
        *,
        status_code: int | None = None,
        retryable: bool | None = None,
    ) -> None:
        safe_message = message or self.default_message
        self.info = BackendErrorInfo(
            kind=self.kind,
            message=safe_message,
            retryable=self.retryable if retryable is None else retryable,
            status_code=status_code,
        )
        super().__init__(safe_message)


class ConfigurationFailure(RuntimeFailure):
    kind: ErrorKind = "configuration"
    default_message = "Çalışma zamanı yapılandırması geçersiz."


class ConnectionFailure(RuntimeFailure):
    kind: ErrorKind = "connection"
    default_message = "Yerel çalışma zamanına bağlanılamadı."
    retryable = True


class RequestTimeoutFailure(RuntimeFailure):
    kind: ErrorKind = "timeout"
    default_message = "Yerel çalışma zamanı isteği zaman aşımına uğradı."
    retryable = True


class HTTPStatusFailure(RuntimeFailure):
    kind: ErrorKind = "http_status"
    default_message = "Yerel çalışma zamanı başarısız bir HTTP durumu döndürdü."


class MalformedResponseFailure(RuntimeFailure):
    kind: ErrorKind = "malformed_response"
    default_message = "Yerel çalışma zamanı geçersiz bir yanıt döndürdü."


class ModelUnavailableFailure(RuntimeFailure):
    kind: ErrorKind = "model_unavailable"
    default_message = "Yapılandırılan model yerel çalışma zamanında bulunamadı."


class CapabilityUnavailableFailure(RuntimeFailure):
    kind: ErrorKind = "capability_unavailable"
    default_message = "İstenen profil bu backend için doğrulanmış değil."


class PrivacyPolicyFailure(RuntimeFailure):
    kind: ErrorKind = "privacy_policy"
    default_message = "Bağlantı hedefi gizlilik politikasına uygun değil."


class InternalRuntimeFailure(RuntimeFailure):
    kind: ErrorKind = "internal"
    default_message = "Beklenmeyen bir çalışma zamanı hatası oluştu."
