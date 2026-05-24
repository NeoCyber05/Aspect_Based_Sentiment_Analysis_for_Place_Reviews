from __future__ import annotations

import argparse
from pathlib import Path

from export_absa_checkpoint_to_hf import (
    build_model,
    load_checkpoint,
    resolve_aspect_names,
    resolve_base_model_name,
    write_model_card,
)
from export_all_final_weights import DEFAULT_NAME_MAP


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Rewrite README.md files under training/hf_ready using the current model card generator.",
    )
    parser.add_argument("--input-dir", default="training/final_weight")
    parser.add_argument("--output-root", default="training/hf_ready")
    parser.add_argument("--namespace", default="NeoCyber")
    parser.add_argument("--dropout-prob", type=float, default=0.2)
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    input_dir = Path(args.input_dir)
    output_root = Path(args.output_root)

    for checkpoint_path in sorted(input_dir.glob("*.pt")):
        checkpoint = load_checkpoint(checkpoint_path)
        base_model_name = resolve_base_model_name(checkpoint, "")
        output_names = resolve_aspect_names(checkpoint)
        _, config, kind = build_model(checkpoint, base_model_name, output_names, args.dropout_prob)

        output_name = DEFAULT_NAME_MAP.get(checkpoint_path.stem, checkpoint_path.stem)
        output_dir = output_root / output_name
        if not output_dir.exists():
            raise FileNotFoundError(f"Expected exported model directory not found: {output_dir}")

        repo_id = f"{args.namespace}/{output_name}"
        write_model_card(output_dir, checkpoint_path, checkpoint, config, kind, repo_id=repo_id)
        print(f"Updated README: {output_dir / 'README.md'}")


if __name__ == "__main__":
    main()
