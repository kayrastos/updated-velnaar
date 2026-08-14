from __future__ import annotations

import os
from pathlib import Path


class ToolPolicyError(PermissionError):
    pass


class ReadOnlyPathPolicy:
    """Resolve requested paths inside explicit roots without following symlinks."""

    DEFAULT_DENIED_PARTS = frozenset(
        {
            ".aws",
            ".azure",
            ".git",
            ".gnupg",
            ".kube",
            ".ssh",
        }
    )
    DEFAULT_DENIED_NAMES = frozenset(
        {
            ".env",
            "authorized_keys",
            "credentials",
            "id_dsa",
            "id_ed25519",
            "id_rsa",
            "known_hosts",
        }
    )
    DEFAULT_DENIED_SUFFIXES = frozenset({".key", ".kdbx", ".p12", ".pem", ".pfx"})

    def __init__(
        self,
        allowed_roots: tuple[str | Path, ...],
        *,
        max_file_bytes: int = 1_000_000,
    ) -> None:
        if not allowed_roots:
            raise ValueError("en az bir izinli kok dizin gerekli")
        if max_file_bytes < 1:
            raise ValueError("max_file_bytes pozitif olmali")

        roots: list[Path] = []
        for configured_root in allowed_roots:
            configured = Path(configured_root).expanduser()
            if configured.is_symlink():
                raise ValueError("izinli kok symlink olamaz")
            root = configured.resolve(strict=True)
            if not root.is_dir():
                raise ValueError(f"izinli kok dizin olmali: {root}")
            if root not in roots:
                roots.append(root)
        self.allowed_roots = tuple(roots)
        self.max_file_bytes = max_file_bytes

    def resolve(self, requested_path: str) -> Path:
        raw = Path(requested_path).expanduser()
        if ".." in raw.parts:
            raise ToolPolicyError("ust dizin gecisi yasak")

        candidate = raw if raw.is_absolute() else self.allowed_roots[0] / raw
        lexical = Path(os.path.abspath(candidate))
        lexical_root = self._containing_root(lexical)
        if lexical_root is None:
            raise ToolPolicyError("istenen yol izinli koklerin disinda")

        self._reject_symlink_components(lexical_root, lexical)
        try:
            resolved = lexical.resolve(strict=True)
        except (FileNotFoundError, OSError) as exc:
            raise ToolPolicyError(f"istenen yol kullanilamiyor: {lexical}") from exc

        resolved_root = self._containing_root(resolved)
        if resolved_root is None:
            raise ToolPolicyError("cozumlenen yol izinli koklerin disinda")
        self._reject_sensitive_path(resolved_root, resolved)
        return resolved

    def is_sensitive_name(self, name: str) -> bool:
        normalized = name.casefold()
        return (
            normalized in self.DEFAULT_DENIED_PARTS
            or normalized in self.DEFAULT_DENIED_NAMES
            or normalized.startswith(".env.")
            or Path(normalized).suffix in self.DEFAULT_DENIED_SUFFIXES
        )

    def _containing_root(self, path: Path) -> Path | None:
        for root in self.allowed_roots:
            if path == root or path.is_relative_to(root):
                return root
        return None

    @staticmethod
    def _reject_symlink_components(root: Path, path: Path) -> None:
        current = root
        if current.is_symlink():
            raise ToolPolicyError("symlink kok dizin kullanilamaz")
        for part in path.relative_to(root).parts:
            current = current / part
            if current.is_symlink():
                raise ToolPolicyError("symlink yol bileseni kullanilamaz")

    def _reject_sensitive_path(self, root: Path, path: Path) -> None:
        for part in path.relative_to(root).parts:
            if self.is_sensitive_name(part):
                raise ToolPolicyError("hassas yola erisim reddedildi")
