"""Package a VS Code extension using its package.json files allowlist."""

import argparse
import json
from pathlib import Path
import xml.etree.ElementTree as ET
import zipfile


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def extension_files(root, manifest):
    patterns = manifest.get("files")
    if not isinstance(patterns, list) or not patterns:
        raise ValueError("package.json must declare a nonempty files allowlist.")
    files = {root / "package.json"}
    files.update(root.glob("package.nls*.json"))
    for name in ("README.md", "LICENSE", "LICENSE.txt", "LICENSE.md"):
        if (root / name).is_file():
            files.add(root / name)
    for pattern in patterns:
        if not isinstance(pattern, str) or Path(pattern).is_absolute() or ".." in Path(pattern).parts:
            raise ValueError(f"Invalid package file pattern: {pattern!r}")
        matches = list(root.glob(pattern))
        if not matches:
            raise ValueError(f"Package file pattern matched nothing: {pattern}")
        for match in matches:
            files.update(match.rglob("*") if match.is_dir() else [match])
    result = []
    for file in sorted(files):
        if not file.is_file():
            continue
        if not file.resolve().is_relative_to(root):
            raise ValueError(f"Package file is outside the extension directory: {file}")
        if file.relative_to(root).parts[0] in ("dist", ".git", "node_modules"):
            raise ValueError(f"Build or dependency directory is in the files allowlist: {file}")
        result.append(file)
    return result


def vsix_manifest(root, manifest, files):
    namespace = "http://schemas.microsoft.com/developer/vsx-schema/2011"
    ET.register_namespace("", namespace)

    def add(parent, tag, text=None, **attributes):
        node = ET.SubElement(parent, f"{{{namespace}}}{tag}", attributes)
        node.text = text
        return node

    strings_path = root / "package.nls.json"
    strings = read_json(strings_path) if strings_path.is_file() else {}

    def localized(value):
        if value.startswith("%") and value.endswith("%"):
            return strings[value[1:-1]]
        return value

    package = ET.Element(f"{{{namespace}}}PackageManifest", Version="2.0.0")
    metadata = add(package, "Metadata")
    add(metadata, "Identity", Language="en-US", Id=manifest["name"],
        Version=manifest["version"], Publisher=manifest["publisher"])
    add(metadata, "DisplayName", localized(manifest.get("displayName", manifest["name"])))
    add(metadata, "Description", localized(manifest.get("description", "")))
    add(metadata, "Tags", ",".join(manifest.get("keywords", [])))
    add(metadata, "Categories", ",".join(manifest.get("categories", [])))
    properties = add(metadata, "Properties")
    values = {
        "Microsoft.VisualStudio.Code.Engine": manifest["engines"]["vscode"],
        "Microsoft.VisualStudio.Code.ExtensionDependencies": ",".join(manifest.get("extensionDependencies", [])),
        "Microsoft.VisualStudio.Code.ExtensionPack": ",".join(manifest.get("extensionPack", [])),
    }
    if "extensionKind" in manifest:
        kind = manifest["extensionKind"]
        values["Microsoft.VisualStudio.Code.ExtensionKind"] = kind if isinstance(kind, str) else ",".join(kind)
    for key, value in values.items():
        add(properties, "Property", Id=key, Value=value)
    license_file = next((file for file in files if file.parent == root
                         and file.name in ("LICENSE", "LICENSE.txt", "LICENSE.md")), None)
    if license_file:
        add(metadata, "License", "extension/" + license_file.relative_to(root).as_posix())
    installation = add(package, "Installation")
    add(installation, "InstallationTarget", Id="Microsoft.VisualStudio.Code")
    add(package, "Dependencies")
    assets = add(package, "Assets")
    add(assets, "Asset", Type="Microsoft.VisualStudio.Code.Manifest",
        Path="extension/package.json", Addressable="true")
    if root / "README.md" in files:
        add(assets, "Asset", Type="Microsoft.VisualStudio.Services.Content.Details",
            Path="extension/README.md", Addressable="true")
    if license_file:
        add(assets, "Asset", Type="Microsoft.VisualStudio.Services.Content.License",
            Path="extension/" + license_file.relative_to(root).as_posix(), Addressable="true")
    ET.indent(package)
    return ET.tostring(package, encoding="utf-8", xml_declaration=True)


def content_types(root, files):
    namespace = "http://schemas.openxmlformats.org/package/2006/content-types"
    ET.register_namespace("", namespace)
    types = ET.Element(f"{{{namespace}}}Types")
    known = {"json": "application/json", "js": "application/javascript", "md": "text/markdown",
             "txt": "text/plain", "css": "text/css", "svg": "image/svg+xml", "png": "image/png"}
    for suffix in sorted({file.suffix.lstrip(".") for file in files if file.suffix}):
        ET.SubElement(types, f"{{{namespace}}}Default", Extension=suffix,
                      ContentType=known.get(suffix, "application/octet-stream"))
    ET.SubElement(types, f"{{{namespace}}}Default", Extension="vsixmanifest", ContentType="text/xml")
    for file in files:
        if not file.suffix:
            ET.SubElement(types, f"{{{namespace}}}Override", PartName="/extension/" + file.relative_to(root).as_posix(),
                          ContentType="text/plain")
    ET.indent(types)
    return ET.tostring(types, encoding="utf-8", xml_declaration=True)


def package_extension(extension_dir):
    root = extension_dir.resolve()
    manifest = read_json(root / "package.json")
    files = extension_files(root, manifest)
    metadata = vsix_manifest(root, manifest, files)
    types = content_types(root, files)
    filename = f"{manifest['name']}-{manifest['version']}.vsix"
    if Path(filename).name != filename:
        raise ValueError("Extension name and version must form a filename.")
    output = root / "dist" / filename
    output.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("extension.vsixmanifest", metadata)
        archive.writestr("[Content_Types].xml", types)
        for file in files:
            archive.write(file, "extension/" + file.relative_to(root).as_posix())
    with zipfile.ZipFile(output) as archive:
        if archive.testzip() is not None:
            raise ValueError("VSIX archive integrity check failed.")
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("extension_dir", type=Path, help="Extension directory containing package.json")
    arguments = parser.parse_args()
    try:
        print(package_extension(arguments.extension_dir))
    except (OSError, ValueError, KeyError) as error:
        parser.exit(1, f"Packaging failed: {error}\n")
