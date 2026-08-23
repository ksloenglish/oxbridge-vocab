from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


SCHEMA_VERSION = 2
RELEASE_VERSION_PATTERN = re.compile(r"^\d{8}\.\d{4}$")
COLLECTION_ORDER = [
    "ox3000-a1",
    "ox3000-a2",
    "ox3000-b1",
    "ox3000-b2",
    "ox5000-b2",
    "ox5000-c1",
    "cambridge-c2",
]
ALLOWED_QUESTION_KEYS = {
    "id",
    "headword",
    "collectionId",
    "segmentId",
    "question",
    "answer",
    "distractors",
    "definition",
    "optionDefinitions",
}
FORBIDDEN_KEY_FRAGMENTS = {
    "audit",
    "approval",
    "candidate",
    "example_sentence",
    "manifest",
    "pos_raw",
    "provenance",
    "review",
    "source_file",
    "source_list",
    "semantic",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate public Oxbridge release JSON.")
    parser.add_argument("--release-dir", required=True, type=Path)
    return parser.parse_args()


def normalised(value: str) -> str:
    return value.strip().casefold()


def fail(message: str) -> None:
    raise ValueError(message)


def main() -> None:
    args = parse_args()
    release_dir = args.release_dir.resolve()
    catalogue_path = release_dir / "catalog.json"
    if not catalogue_path.is_file():
        raise SystemExit("Missing catalog.json")

    non_json_files = [path.name for path in release_dir.iterdir() if path.suffix != ".json"]
    if non_json_files:
        raise SystemExit(f"Unexpected non-JSON release files: {non_json_files}")

    catalogue = json.loads(catalogue_path.read_text(encoding="utf-8"))
    if catalogue.get("schemaVersion") != SCHEMA_VERSION:
        fail("Unsupported catalogue schema version")
    release_version = catalogue.get("releaseVersion")
    if not isinstance(release_version, str) or not RELEASE_VERSION_PATTERN.fullmatch(
        release_version
    ):
        fail("Release version must use yyyyMMdd.HHmm")
    if catalogue.get("definitionLanguage") != "zh-Hant":
        fail("Definition language must be zh-Hant")

    collections = catalogue.get("collections")
    if not isinstance(collections, list):
        fail("Catalogue collections must be an array")
    if [item.get("id") for item in collections] != COLLECTION_ORDER:
        fail("Catalogue collection order or identity is invalid")

    expected_segment_ids = {
        f"{collection_id}-p{part}"
        for collection_id in COLLECTION_ORDER
        for part in (1, 2)
    }
    catalogued_segment_ids: set[str] = set()
    expected_files = {"catalog.json"}
    seen_question_ids: set[str] = set()
    released_total = 0

    for collection in collections:
        collection_id = collection["id"]
        segments = collection.get("segments")
        if not isinstance(segments, list) or len(segments) != 2:
            fail(f"{collection_id}: exactly two segments are required")
        for part, segment in enumerate(segments, start=1):
            segment_id = segment.get("id")
            expected_segment_id = f"{collection_id}-p{part}"
            if segment_id != expected_segment_id:
                fail(f"{collection_id}: segment identity or order is invalid")
            catalogued_segment_ids.add(segment_id)
            data_file = segment.get("dataFile")
            if data_file != f"{segment_id}.json":
                fail(f"{segment_id}: unsafe or unexpected data file name")
            expected_files.add(data_file)
            segment_path = release_dir / data_file
            payload = json.loads(segment_path.read_text(encoding="utf-8"))
            if payload.get("schemaVersion") != SCHEMA_VERSION:
                fail(f"{segment_id}: schema version mismatch")
            if payload.get("releaseVersion") != release_version:
                fail(f"{segment_id}: release version mismatch")
            if payload.get("collectionId") != collection_id:
                fail(f"{segment_id}: collection impurity")
            if payload.get("segmentId") != segment_id:
                fail(f"{segment_id}: segment impurity")
            questions = payload.get("questions")
            if not isinstance(questions, list):
                fail(f"{segment_id}: questions must be an array")
            if len(questions) != segment.get("availableCount"):
                fail(f"{segment_id}: catalogue count mismatch")

            for row_number, question in enumerate(questions, start=1):
                prefix = f"{segment_id} row {row_number}"
                if not isinstance(question, dict):
                    fail(f"{prefix}: question must be an object")
                if set(question) != ALLOWED_QUESTION_KEYS:
                    fail(f"{prefix}: public field set is invalid")
                for key in question:
                    lowered = key.casefold()
                    if any(fragment in lowered for fragment in FORBIDDEN_KEY_FRAGMENTS):
                        fail(f"{prefix}: forbidden private field {key}")
                question_id = question["id"]
                if question_id in seen_question_ids:
                    fail(f"{prefix}: duplicate released ID {question_id}")
                seen_question_ids.add(question_id)
                if question["collectionId"] != collection_id:
                    fail(f"{prefix}: collection classification mismatch")
                if question["segmentId"] != segment_id:
                    fail(f"{prefix}: segment classification mismatch")
                sentence = question["question"]
                if not isinstance(sentence, str) or sentence.count("{BLANK}") != 1:
                    fail(f"{prefix}: exactly one blank is required")
                answer = question["answer"]
                distractors = question["distractors"]
                if not isinstance(distractors, list) or len(distractors) != 3:
                    fail(f"{prefix}: exactly three distractors are required")
                options = [answer, *distractors]
                if not all(isinstance(option, str) and option.strip() for option in options):
                    fail(f"{prefix}: every visible option must be non-empty")
                if len({normalised(option) for option in options}) != 4:
                    fail(f"{prefix}: visible options must be unique")
                if not isinstance(question["headword"], str) or not question["headword"].strip():
                    fail(f"{prefix}: missing headword")
                if not isinstance(question["definition"], str) or not question["definition"].strip():
                    fail(f"{prefix}: missing definition")
                option_definitions = question["optionDefinitions"]
                if not isinstance(option_definitions, dict):
                    fail(f"{prefix}: option definitions must be an object")
                if set(option_definitions) != set(options):
                    fail(f"{prefix}: option definitions must cover the exact four visible options")
                if not all(
                    isinstance(value, str) and value.strip()
                    for value in option_definitions.values()
                ):
                    fail(f"{prefix}: every visible option needs a non-empty definition")
                if option_definitions.get(answer) != question["definition"]:
                    fail(f"{prefix}: answer definition is inconsistent")
                if sentence.lstrip().startswith("{BLANK}"):
                    for option in options:
                        first_cased = next(
                            (character for character in option.strip() if character.isalpha()),
                            None,
                        )
                        if first_cased is None or first_cased != first_cased.upper():
                            fail(f"{prefix}: D1 requires capitalised sentence-initial options")
            released_total += len(questions)

    if catalogued_segment_ids != expected_segment_ids:
        fail("Catalogue does not contain the exact immutable segment map")
    actual_files = {path.name for path in release_dir.glob("*.json")}
    if actual_files != expected_files:
        fail("Release directory contains missing or unexpected JSON files")
    if released_total != catalogue.get("releasedQuestionCount"):
        fail("Aggregate released count does not match catalogue")

    print(
        json.dumps(
            {
                "status": "pass",
                "releaseVersion": release_version,
                "collectionCount": len(collections),
                "segmentCount": len(catalogued_segment_ids),
                "releasedQuestionCount": released_total,
                "uniqueQuestionIds": len(seen_question_ids),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
