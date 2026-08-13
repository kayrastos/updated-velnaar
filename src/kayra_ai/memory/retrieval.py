from __future__ import annotations

import re
from collections import Counter

from .contracts import MemoryQuery, RetrievedMemory
from .store import MemoryStore


_WORD = re.compile(r"[^\W_]+", flags=re.UNICODE)


def _terms(text: str) -> tuple[str, ...]:
    return tuple(dict.fromkeys(term.casefold() for term in _WORD.findall(text) if len(term) >= 2))


class LexicalMemoryRetriever:
    """Dependency-free retrieval for the first offline memory milestone."""

    def __init__(self, store: MemoryStore) -> None:
        self.store = store

    def search(self, query: MemoryQuery) -> list[RetrievedMemory]:
        query_terms = _terms(query.text)
        if not query_terms:
            return []
        query_phrase = query.text.strip().casefold()
        results: list[RetrievedMemory] = []

        for record in self.store.active_records():
            if query.kinds is not None and record.kind not in query.kinds:
                continue
            searchable = " ".join((record.content, record.source, *record.tags)).casefold()
            counts = Counter(_WORD.findall(searchable))
            matched = tuple(term for term in query_terms if term in searchable)
            if not matched:
                continue
            score = float(sum(1 + counts.get(term, 0) for term in matched))
            if query_phrase and query_phrase in searchable:
                score += 4.0
            results.append(
                RetrievedMemory(record=record, score=score, matched_terms=matched)
            )

        results.sort(key=lambda item: (-item.score, item.record.id))
        return results[: query.top_k]
