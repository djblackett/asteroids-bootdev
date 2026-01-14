"""Ensure pygbag's generated HTML always shows the debug console.

pygbag hides the built-in terminal UI unless the page hash contains
#debug, so we patch build/web/index.html after each build to keep it
visible for easier troubleshooting in the browser.
"""

from __future__ import annotations

import argparse
import pathlib
import re
import sys


FORCE_MARKER = "__forceDebugConsoleVisible"

HIDDEN_BLOCK_PATTERN = re.compile(
    r"(?m)([ \t]*)pyconsole\.hidden\s*=\s*debug_hidden\s*"
    r"\1system\.hidden\s*=\s*debug_hidden\s*"
    r"\1transfer\.hidden\s*=\s*debug_hidden\s*"
    r"\1info\.hidden\s*=\s*debug_hidden\s*"
    r"\1box\.hidden\s*=\s*debug_hidden"
)


def force_console_visible(index_path: pathlib.Path) -> bool:
    """Patch the generated HTML so the debug console is never hidden."""
    html = index_path.read_text(encoding="utf-8")

    if FORCE_MARKER in html:
        return False

    match = HIDDEN_BLOCK_PATTERN.search(html)
    if not match:
        raise SystemExit(
            "Unable to locate custom_onload() visibility block in "
            f"{index_path}. The pygbag template probably changed."
        )

    indent = match.group(1) or "        "
    replacement = "\n".join(
        [
            f"{indent}const {FORCE_MARKER} = true;",
            f"{indent}const __debugConsoleHidden = {FORCE_MARKER} ? false : debug_hidden;",
            f"{indent}pyconsole.hidden = __debugConsoleHidden",
            f"{indent}system.hidden = __debugConsoleHidden",
            f"{indent}transfer.hidden = __debugConsoleHidden",
            f"{indent}info.hidden = __debugConsoleHidden",
            f"{indent}box.hidden =  __debugConsoleHidden",
        ]
    )

    updated = (
        html[: match.start()]
        + replacement
        + html[match.end() :]
    )
    index_path.write_text(updated, encoding="utf-8")
    return True


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Force pygbag's debug console to stay visible."
    )
    parser.add_argument(
        "html",
        nargs="?",
        default=pathlib.Path("build/web/index.html"),
        type=pathlib.Path,
        help="Path to the generated index.html file (default: build/web/index.html)",
    )
    args = parser.parse_args()

    index_path = args.html
    if not index_path.exists():
        raise SystemExit(f"{index_path} does not exist. Build the web target first.")

    changed = force_console_visible(index_path)
    if changed:
        print(f"Patched {index_path} to keep the pygbag console visible.")
    else:
        print(f"{index_path} already configured to keep the console visible.")


if __name__ == "__main__":
    try:
        main()
    except SystemExit as exc:
        print(exc, file=sys.stderr)
        raise
