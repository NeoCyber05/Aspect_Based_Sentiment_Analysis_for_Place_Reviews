from __future__ import annotations

import html
import re
import unicodedata
from pathlib import Path
from urllib.request import urlretrieve


VNCORENLP_BASE_URL = "https://raw.githubusercontent.com/vncorenlp/VnCoreNLP/master"
VNCORENLP_FILES = [
    "VnCoreNLP-1.2.jar",
    "models/wordsegmenter/vi-vocab",
    "models/wordsegmenter/wordsegmenter.rdr",
]


class TextPreprocessor:

    def __init__(
        self,
        teencode_path: str | Path,
        use_word_segmentation: bool = False,
        vncorenlp_dir: str | Path = "VnCoreNLP",
    ) -> None:
        self.teencode_path = Path(teencode_path)
        self.use_word_segmentation = use_word_segmentation
        self.vncorenlp_dir = Path(vncorenlp_dir)
        self._acronym_map: dict[str, str] | None = None
        self._segmenter = None

    def _build_acronym_map(self) -> dict[str, str]:
        mapping: dict[str, str] = {}
        if not self.teencode_path.exists():
            return mapping

        for line in self.teencode_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            if "\t" in line:
                teencode, normalized = line.split("\t", 1)
            elif " - " in line:
                teencode, normalized = line.split(" - ", 1)
            else:
                continue
            teencode = teencode.strip().lower()
            normalized = normalized.strip()
            if teencode and normalized:
                mapping[teencode] = normalized
        return mapping

    @property
    def acronym_map(self) -> dict[str, str]:
        if self._acronym_map is None:
            self._acronym_map = self._build_acronym_map()
        return self._acronym_map

    def _normalize_acronyms(self, text: str) -> str:
        return " ".join(self.acronym_map.get(word.lower(), word) for word in text.split())

    def _word_segmentation(self, text: str) -> str:
        if not self.use_word_segmentation:
            return text
        if self._segmenter is None:
            try:
                from vncorenlp import VnCoreNLP  # type: ignore
            except Exception:
                return text
            try:
                self._ensure_vncorenlp()
            except Exception:
                return text
            vncorenlp_jar = self.vncorenlp_dir / "VnCoreNLP-1.2.jar"
            self._segmenter = VnCoreNLP(str(vncorenlp_jar), annotators="wseg", quiet=True)

        try:
            sentences = self._segmenter.tokenize(text)
            return " ".join(token for sentence in sentences for token in sentence)
        except Exception:
            return text

    def _ensure_vncorenlp(self) -> None:
        for relative_path in VNCORENLP_FILES:
            local_path = self.vncorenlp_dir / relative_path
            if local_path.exists():
                continue
            local_path.parent.mkdir(parents=True, exist_ok=True)
            urlretrieve(f"{VNCORENLP_BASE_URL}/{relative_path}", local_path)

    @staticmethod
    def _remove_unnecessary_characters(text: str) -> str:
        text = re.sub(r"[^\w\s]", " ", text, flags=re.UNICODE)
        return re.sub(r"\s+", " ", text).strip()

    def __call__(self, text: str) -> str:
        text = html.unescape(str(text))
        text = re.sub(r"<[^>]+>", " ", text)
        text = unicodedata.normalize("NFC", text)
        text = self._normalize_acronyms(text)
        text = self._word_segmentation(text)
        return self._remove_unnecessary_characters(text)

