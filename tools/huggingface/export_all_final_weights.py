from __future__ import annotations

import argparse
from pathlib import Path

from export_absa_checkpoint_to_hf import export_checkpoint


DEFAULT_NAME_MAP = {
    "vlsp-2018-restaurant-e5-small-best": "m-e5-small-vlsp2018-restaurant",
    "vlsp-2018-hotel-e5-small-best": "m-e5-small-vlsp2018-hotel",
    "hosrev-e5-small-best": "m-e5-small-hosrev",
    "uit-vsfc-uni-e5-small-best": "m-e5-small-uit-vsfc-uni",
}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Export all final notebook .pt checkpoints to Hugging Face-ready folders.",
    )
    parser.add_argument("--input-dir", default="training/final_weight")
    parser.add_argument("--output-root", default="training/hf_ready")
    parser.add_argument("--namespace", default="NeoCyber")
    parser.add_argument("--dropout-prob", type=float, default=0.2)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    input_dir = Path(args.input_dir)
    output_root = Path(args.output_root)

    checkpoint_paths = sorted(input_dir.glob("*.pt"))
    if not checkpoint_paths:
        raise FileNotFoundError(f"No .pt checkpoints found in {input_dir}")

    for checkpoint_path in checkpoint_paths:
        output_name = DEFAULT_NAME_MAP.get(checkpoint_path.stem, checkpoint_path.stem)
        repo_id = f"{args.namespace}/{output_name}"
        output_dir = output_root / output_name
        print(f"{checkpoint_path} -> {output_dir} ({repo_id})")
        export_checkpoint(
            checkpoint_path=checkpoint_path,
            output_dir=output_dir,
            dropout_prob=args.dropout_prob,
            repo_id=repo_id,
        )


if __name__ == "__main__":
    main()
