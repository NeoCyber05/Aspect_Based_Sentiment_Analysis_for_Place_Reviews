from __future__ import annotations

import argparse
from pathlib import Path

from huggingface_hub import HfApi


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Push each exported folder under training/hf_ready to its own Hugging Face model repo.",
    )
    parser.add_argument(
        "--source-root",
        default="training/hf_ready",
        help="Root directory containing one subdirectory per model repo.",
    )
    parser.add_argument(
        "--namespace",
        required=True,
        help="Hugging Face namespace, for example NeoCyber.",
    )
    parser.add_argument(
        "--private",
        action="store_true",
        help="Create private repos instead of public ones.",
    )
    parser.add_argument(
        "--list-only",
        action="store_true",
        help="Only print which repos would be pushed.",
    )
    parser.add_argument(
        "--readme-only",
        action="store_true",
        help="Only upload README.md for each model repo.",
    )
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    source_root = Path(args.source_root)
    model_dirs = sorted(path for path in source_root.iterdir() if path.is_dir())
    if not model_dirs:
        raise FileNotFoundError(f"No model directories found in {source_root}")

    api = None if args.list_only else HfApi()

    for model_dir in model_dirs:
        repo_id = f"{args.namespace}/{model_dir.name}"
        print(f"{model_dir} -> {repo_id}")
        if args.list_only:
            continue

        api.create_repo(repo_id=repo_id, repo_type="model", private=args.private, exist_ok=True)
        if args.readme_only:
            readme_path = model_dir / "README.md"
            if not readme_path.exists():
                raise FileNotFoundError(f"README.md not found in {model_dir}")
            api.upload_file(
                repo_id=repo_id,
                repo_type="model",
                path_in_repo="README.md",
                path_or_fileobj=str(readme_path),
                commit_message="Update model card",
            )
            continue

        api.upload_folder(repo_id=repo_id, repo_type="model", folder_path=str(model_dir))


if __name__ == "__main__":
    main()
