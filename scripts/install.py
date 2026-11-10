"""Package and install the VS Code extensions in this repository."""

import argparse
import os
from pathlib import Path
import re
import shutil
import subprocess

from package_vsix import package_extension, read_json


ROOT = Path(__file__).resolve().parents[1]


def code_cli(command):
    executable = shutil.which(command)
    if not executable:
        raise ValueError(f"VS Code command not found: {command}")
    path = Path(executable).resolve()
    environment = os.environ.copy()
    if path.suffix.lower() in (".cmd", ".bat"):
        # Run the executable and CLI directly so batch-shell quoting is unnecessary.
        dispatcher = path.read_text(encoding="utf-8-sig")
        program = re.search(r'"(%~dp0[^"\r\n]*\.exe)"', dispatcher, re.IGNORECASE)
        script = re.search(r'"(%~dp0[^"\r\n]*cli\.js)"', dispatcher, re.IGNORECASE)
        if not program or not script:
            raise ValueError(f"Unsupported VS Code command dispatcher: {path}")
        targets = [(path.parent / match[1][len("%~dp0"):]).resolve() for match in (program, script)]
        if not all(target.is_file() for target in targets):
            raise ValueError(f"VS Code executable or CLI script is missing: {path}")
        environment["ELECTRON_RUN_AS_NODE"] = "1"
        environment.pop("VSCODE_DEV", None)
        return [str(target) for target in targets], environment
    return [str(path)], environment


def projects(selected):
    found = []
    for directory in sorted(ROOT.iterdir()):
        manifest_path = directory / "package.json"
        if directory.is_dir() and manifest_path.is_file():
            manifest = read_json(manifest_path)
            if manifest.get("engines", {}).get("vscode") and manifest.get("files"):
                found.append((directory, manifest))
    if selected:
        names = {value for directory, manifest in found for value in (directory.name, manifest["name"])}
        unknown = set(selected) - names
        if unknown:
            raise ValueError("Unknown plugin(s): " + ", ".join(sorted(unknown)))
        found = [(directory, manifest) for directory, manifest in found
                 if directory.name in selected or manifest["name"] in selected]
    if not found:
        raise ValueError("No extension projects found.")
    return found


def install(args):
    selected = projects(args.plugin)
    command, environment = code_cli(args.code) if not args.package_only else ([], {})
    for directory, manifest in selected:
        output = package_extension(directory)
        print(f"Packaged {manifest['name']}: {output}", flush=True)
        if not args.package_only:
            options = ["--install-extension", str(output), "--force"]
            if args.profile:
                options += ["--profile", args.profile]
            if args.extensions_dir:
                options += ["--extensions-dir", str(args.extensions_dir.resolve())]
            if args.user_data_dir:
                options += ["--user-data-dir", str(args.user_data_dir.resolve())]
            result = subprocess.run([*command, *options], env=environment,
                                    capture_output=True, encoding="utf-8", errors="replace")
            if result.stdout:
                print(result.stdout, end="" if result.stdout.endswith("\n") else "\n", flush=True)
            if result.stderr:
                print(result.stderr, end="" if result.stderr.endswith("\n") else "\n", flush=True)
            if result.returncode:
                raise ValueError(f"VS Code rejected installation of {manifest['name']} (exit status {result.returncode}).")
    print(f"{'Packaged' if args.package_only else 'Installed'} {len(selected)} extension(s).")
    if not args.package_only:
        print("Reload VS Code, select the theme, and run each effects plugin's enable command once.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plugin", nargs="+", help="Folder names or extension names; defaults to all")
    parser.add_argument("--profile", help="VS Code profile to install into")
    parser.add_argument("--package-only", action="store_true", help="Build VSIX files without installing")
    parser.add_argument("--code", default="code", help="VS Code CLI command or path")
    parser.add_argument("--extensions-dir", type=Path, help="Override the extension installation directory")
    parser.add_argument("--user-data-dir", type=Path, help="Override the VS Code user data directory")
    arguments = parser.parse_args()
    try:
        install(arguments)
    except (OSError, ValueError, KeyError) as error:
        parser.exit(1, f"Installation failed: {error}\n")
