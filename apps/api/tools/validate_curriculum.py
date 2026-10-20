"""Command-line entry point for the runtime's shared curriculum validator."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(API_ROOT))

from app.content.curriculum.validation import validate_catalogue


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("catalogue", nargs="?", type=Path, default=API_ROOT / "app/content/curriculum/web-fs-01.json")
    parser.add_argument("--test-registry", type=Path)
    parser.add_argument("--base-dir", type=Path, default=API_ROOT)
    args = parser.parse_args()
    try:
        data = json.loads(args.catalogue.read_text(encoding="utf-8"))
        registry_path = args.test_registry or args.catalogue.with_name("test-registry.json")
        registry = json.loads(registry_path.read_text(encoding="utf-8")) if registry_path.is_file() else None
        validate_catalogue(data, base_dir=args.base_dir, test_registry=registry)
    except (OSError, ValueError) as exc:
        parser.exit(1, f"커리큘럼 구조 검증 실패: {exc}\n")
    print(f"커리큘럼 구조 정상: {data['course_id']} / {data['publication_state']} (실행·평가 검증 결과와 별개)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
