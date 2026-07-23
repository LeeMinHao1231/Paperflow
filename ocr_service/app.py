from __future__ import annotations

import os
import re
import statistics
import tempfile
from pathlib import Path
from threading import Lock
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parent.parent
os.environ.setdefault("PADDLE_PDX_CACHE_HOME", str(PROJECT_ROOT / ".paddlex-cache"))
os.environ.setdefault("PADDLE_PDX_MODEL_SOURCE", "huggingface")
os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
_system_expanduser = os.path.expanduser
_system_home = _system_expanduser("~")
_local_home = str(PROJECT_ROOT / ".paddle-home")


def _workspace_expanduser(path: str) -> str:
    expanded = _system_expanduser(path)
    if expanded == _system_home:
        return _local_home
    if expanded.startswith(_system_home + os.sep):
        return _local_home + expanded[len(_system_home):]
    return expanded


os.path.expanduser = _workspace_expanduser

from fastapi import FastAPI, File, HTTPException, UploadFile
from paddleocr import PaddleOCR

MAX_IMAGE_BYTES = 12 * 1024 * 1024
SUPPORTED_TYPES = {"image/jpeg", "image/png", "image/webp"}
LOW_CONFIDENCE = 0.72

app = FastAPI(title="Paperflow PaddleOCR", docs_url=None, redoc_url=None)
_model: PaddleOCR | None = None
_model_lock = Lock()


def get_model() -> PaddleOCR:
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                _model = PaddleOCR(
                    lang=os.getenv("PADDLEOCR_LANG", "en"),
                    text_recognition_model_name=os.getenv(
                        "PADDLEOCR_RECOGNITION_MODEL",
                        "en_PP-OCRv5_mobile_rec",
                    ),
                    use_doc_orientation_classify=True,
                    use_doc_unwarping=True,
                    use_textline_orientation=True,
                )
    return _model


def as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if hasattr(value, "tolist"):
        return value.tolist()
    return list(value)


def recognized_items(result: Any) -> list[dict[str, Any]]:
    payload = result.json if hasattr(result, "json") else result
    if callable(payload):
        payload = payload()
    data = payload.get("res", payload)
    texts = as_list(data.get("rec_texts"))
    scores = as_list(data.get("rec_scores"))
    boxes = as_list(data.get("rec_boxes"))
    if not boxes:
        polygons = as_list(data.get("rec_polys"))
        boxes = [
            [min(point[0] for point in polygon), min(point[1] for point in polygon),
             max(point[0] for point in polygon), max(point[1] for point in polygon)]
            for polygon in polygons
        ]

    items: list[dict[str, Any]] = []
    for index, raw_text in enumerate(texts):
        text = str(raw_text).strip()
        if not text or index >= len(boxes):
            continue
        x1, y1, x2, y2 = (float(value) for value in boxes[index][:4])
        items.append({
            "text": text,
            "score": float(scores[index]) if index < len(scores) else 1.0,
            "x1": x1,
            "y1": y1,
            "x2": x2,
            "y2": y2,
            "cx": (x1 + x2) / 2,
            "cy": (y1 + y2) / 2,
            "height": max(y2 - y1, 1.0),
        })
    return items


def group_lines(items: list[dict[str, Any]], height_factor: float = 0.45) -> list[list[dict[str, Any]]]:
    if not items:
        return []
    tolerance = max(6.0, statistics.median(item["height"] for item in items) * height_factor)
    lines: list[list[dict[str, Any]]] = []
    for item in sorted(items, key=lambda value: (value["cy"], value["x1"])):
        target = next(
            (line for line in lines if abs(statistics.mean(part["cy"] for part in line) - item["cy"]) <= tolerance),
            None,
        )
        if target is None:
            lines.append([item])
        else:
            target.append(item)
    return [sorted(line, key=lambda value: value["x1"]) for line in lines]


def line_text(line: list[dict[str, Any]]) -> str:
    return " ".join(item["text"] for item in line).strip()


HEADER_WORDS = {
    "no", "name", "company", "business", "contact", "phone", "mobile", "email",
    "address", "visitor", "pass", "number", "signature", "department", "role",
    "designation", "remarks", "check", "attendance",
}


def header_score(line: list[dict[str, Any]]) -> float:
    normalized = re.findall(r"[a-z]+", line_text(line).lower())
    matches = sum(word in HEADER_WORDS for word in normalized)
    width_bonus = len(line) * 0.35
    return matches * 3 + width_bonus if len(line) >= 2 else 0


def find_header_line(lines: list[list[dict[str, Any]]]) -> list[dict[str, Any]]:
    if not lines:
        return []
    candidates = sorted(lines, key=header_score, reverse=True)
    return candidates[0] if header_score(candidates[0]) >= 2 else []


def extract_metadata(lines: list[list[dict[str, Any]]], header_y: float) -> dict[str, str]:
    metadata = {"name": "", "date": "", "time": "", "venue": "", "region": ""}
    aliases = {
        "name": ("event name", "event title"),
        "date": ("event date / day", "event date", "date / day", "date"),
        "time": ("event time", "time"),
        "venue": ("event place", "event venue", "venue", "location"),
        "region": ("region",),
    }
    for line in lines:
        if statistics.mean(item["cy"] for item in line) >= header_y:
            continue
        text = line_text(line)
        normalized = re.sub(r"\s+", " ", text).strip()
        lower = normalized.lower()
        for key, labels in aliases.items():
            for label in labels:
                match = re.search(rf"\b{re.escape(label)}\b\s*[:\-]?\s*(.+)$", lower, re.IGNORECASE)
                if match and not metadata[key]:
                    start = match.start(1)
                    metadata[key] = normalized[start:].strip(" :-")
                    break
    return metadata


def table_rows(items: list[dict[str, Any]], header: list[dict[str, Any]]) -> tuple[list[str], list[list[str]]]:
    headers = [dict(item) for item in header]
    if not headers:
        raise ValueError("Could not find a table header. Retake the photo straight-on with the full page visible.")

    metadata_labels = {"region", "venue", "location"}
    remove_indexes: set[int] = set()
    for index, item in enumerate(headers):
        if item["text"].strip().lower() not in metadata_labels:
            continue
        for value_index in range(index + 1, min(index + 4, len(headers))):
            if headers[value_index]["text"].lstrip().startswith(":"):
                remove_indexes.update({index, value_index})
                break
    headers = [item for index, item in enumerate(headers) if index not in remove_indexes]

    columns = [item["text"] for item in headers]
    boundaries = [
        (headers[index]["x2"] + headers[index + 1]["x1"]) / 2
        for index in range(len(headers) - 1)
    ]
    if re.fullmatch(r"(?:no\.?|number|#)", columns[0].strip(), re.IGNORECASE) and boundaries:
        gap = headers[1]["x1"] - headers[0]["x2"]
        boundaries[0] = headers[0]["x2"] + max(gap, 0) * 0.1
    header_bottom = max(item["y2"] for item in header)
    body = [item for item in items if item["cy"] > header_bottom]
    rows: list[list[str]] = []
    has_number_column = bool(re.fullmatch(r"(?:no\.?|number|#)", columns[0].strip(), re.IGNORECASE))
    contact_index = next((index for index, name in enumerate(columns) if re.search(r"contact|phone|mobile", name, re.I)), None)
    email_index = next((index for index, name in enumerate(columns) if "email" in name.lower()), None)
    for line in group_lines(body, height_factor=0.78):
        if not line:
            continue
        values: list[list[str]] = [[] for _ in columns]
        for item in line:
            phone_email = re.fullmatch(r"([+0-9][0-9() .-]{6,})([A-Za-z][^\s]*@.+)", item["text"])
            if phone_email and contact_index is not None and email_index is not None:
                values[contact_index].append(phone_email.group(1).strip())
                values[email_index].append(phone_email.group(2).strip())
                continue
            column_index = sum(item["cx"] > boundary for boundary in boundaries)
            values[column_index].append(item["text"])
        row = [" ".join(parts).strip() for parts in values]
        if has_number_column and rows and not re.fullmatch(r"\d+\.?", row[0]):
            break
        if sum(bool(value) for value in row) >= 1:
            rows.append(row)

    if has_number_column:
        for index, row in enumerate(rows, start=1):
            row[0] = str(index)
    return columns, rows


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ready", "engine": "PaddleOCR"}


@app.post("/analyze")
async def analyze(image: UploadFile = File(...)) -> dict[str, Any]:
    if image.content_type not in SUPPORTED_TYPES:
        raise HTTPException(415, detail="Please use a JPG, PNG, or WebP photo.")
    content = await image.read(MAX_IMAGE_BYTES + 1)
    if len(content) > MAX_IMAGE_BYTES:
        raise HTTPException(413, detail="The photo is too large. Please keep it below 12 MB.")

    suffix = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}[image.content_type]
    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp:
            temp.write(content)
            temp_path = Path(temp.name)
        predictions = get_model().predict(str(temp_path))
        items: list[dict[str, Any]] = []
        for prediction in predictions:
            items.extend(recognized_items(prediction))
        if not items:
            raise ValueError("No readable text was found. Try brighter, sharper, straighter photo.")

        lines = group_lines(items)
        header = find_header_line(lines)
        columns, rows = table_rows(items, header)
        event = extract_metadata(lines, min(item["cy"] for item in header))
        low_confidence = sum(item["score"] < LOW_CONFIDENCE for item in items)
        warnings = ["Local OCR can misread handwriting; review highlighted blanks before export."]
        if low_confidence:
            warnings.append(f"{low_confidence} text areas had low recognition confidence.")
        return {"event": event, "columns": columns, "rows": rows, "warnings": warnings}
    except ValueError as error:
        raise HTTPException(422, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(500, detail=f"PaddleOCR failed: {type(error).__name__}") from error
    finally:
        if temp_path:
            temp_path.unlink(missing_ok=True)
