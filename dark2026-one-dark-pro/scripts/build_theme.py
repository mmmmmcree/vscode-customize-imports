"""Regenerate the local color theme from installed Dark 2026 and One Dark Pro."""

import argparse
import json
from pathlib import Path
import re
import shutil


ROOT = Path(__file__).resolve().parents[1]


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def read_colors(path, ancestors=()):
    path = path.resolve()
    if path in ancestors:
        raise ValueError(f"Circular theme include: {path}")
    theme = read_json(path)
    colors = {}
    if theme.get("include"):
        colors.update(read_colors(path.parent / theme["include"], (*ancestors, path)))
    colors.update(theme.get("colors", {}))
    return colors


def find_vscode_app(install_dir):
    if install_dir is None:
        command = shutil.which("code")
        if not command:
            raise ValueError("VS Code not found; pass --vscode-dir <installation directory>.")
        install_dir = Path(command).resolve().parent.parent
    candidates = [install_dir, install_dir / "resources" / "app"]
    candidates.extend(install_dir.glob("*/resources/app"))
    for candidate in candidates:
        manifest = candidate / "extensions" / "theme-defaults" / "package.json"
        if manifest.is_file():
            themes = read_json(manifest)["contributes"]["themes"]
            if any(theme.get("id") == "Dark 2026" for theme in themes):
                return candidate
    raise ValueError("Dark 2026 not found in this VS Code installation.")


def find_one_dark_pro(extension_dir):
    if extension_dir is not None:
        return extension_dir
    extensions = Path.home() / ".vscode" / "extensions"
    candidates = [path for path in extensions.glob("zhuangtongfa.material-theme-*")
                  if (path / "package.json").is_file()]
    if not candidates:
        raise ValueError("Install One Dark Pro or pass --one-dark-pro-dir <extension directory>.")
    return max(candidates, key=lambda path: tuple(
        int(part) for part in re.findall(r"\d+", read_json(path / "package.json")["version"])
    ))


def build(args):
    app = find_vscode_app(args.vscode_dir)
    defaults = app / "extensions" / "theme-defaults"
    dark_entry = next(theme for theme in read_json(defaults / "package.json")["contributes"]["themes"]
                      if theme.get("id") == "Dark 2026")
    one_dir = find_one_dark_pro(args.one_dark_pro_dir)
    one_manifest = read_json(one_dir / "package.json")
    one_entry = next(theme for theme in one_manifest["contributes"]["themes"]
                     if theme["label"] == "One Dark Pro")
    one = read_json(one_dir / one_entry["path"])
    override_paths = [ROOT / "theme-overrides.json", *sorted((ROOT / "languages").glob("*.json"))]
    token_overrides = []
    semantic_overrides = {}
    color_overrides = {}
    for override_path in override_paths:
        overrides = read_json(override_path)
        token_overrides.extend(overrides.get("tokenColors", []))
        semantic_overrides.update(overrides.get("semanticTokenColors", {}))
        color_overrides.update(overrides.get("colors", {}))
    colors = read_colors(defaults / dark_entry["path"])
    colors["editor.foreground"] = one["colors"]["editor.foreground"]
    for key in list(colors):
        if key.startswith("editorBracketHighlight."):
            del colors[key]
    colors.update({key: value for key, value in one["colors"].items()
                   if key.startswith("editorBracketHighlight.")})
    colors["dark2026OneDarkPro.glow"] = "#fc28a8"
    colors.update(color_overrides)
    manifest = read_json(ROOT / "package.json")
    entry = manifest["contributes"]["themes"][0]
    theme = {
        "$schema": "vscode://schemas/color-theme",
        "name": entry.get("id", entry["label"]),
        "type": "dark",
        "colors": colors,
        "tokenColors": [*one["tokenColors"], *token_overrides],
        "semanticHighlighting": one.get("semanticHighlighting", True),
        "semanticTokenColors": {**one.get("semanticTokenColors", {}), **semantic_overrides},
    }
    license_path = next((one_dir / name for name in ("LICENSE.txt", "LICENSE", "license.txt")
                         if (one_dir / name).is_file()), None)
    if license_path is None:
        raise ValueError("One Dark Pro license not found.")
    output = ROOT / entry["path"]
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(theme, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (ROOT / "LICENSE.txt").write_text(
        "Dark 2026 UI colors: Copyright (c) Microsoft Corporation. Licensed under MIT.\n"
        "One Dark Pro syntax colors and MIT license:\n\n"
        + license_path.read_text(encoding="utf-8-sig"), encoding="utf-8")
    print(f"Generated {output}")
    print(f"Sources: VS Code {read_json(app / 'package.json')['version']}; "
          f"One Dark Pro {one_manifest['version']}")
    print(f"UI colors: {len(colors)}; TextMate rules: {len(theme['tokenColors'])}; "
          f"semantic rules: {len(theme['semanticTokenColors'])}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vscode-dir", type=Path)
    parser.add_argument("--one-dark-pro-dir", type=Path)
    arguments = parser.parse_args()
    try:
        build(arguments)
    except (OSError, ValueError, KeyError, StopIteration) as error:
        parser.exit(1, f"Build failed: {error}\n")
