import os

ROOT_DIR = os.path.abspath(os.path.dirname(__file__))
OUTPUT_FILE = os.path.join(ROOT_DIR, "codebase_dump.txt")

EXCLUDE_DIRS = {
    ".git",
    "node_modules",
    "venv",
    ".venv",
    "__pycache__",
    "dist",
    "build",
    ".idea",
    ".vscode",
}

EXCLUDE_FILES = {
    "package-lock.json",
    "codebase_dump.txt",
    "dump_codebase.py",
}

SOURCE_EXTENSIONS = {
    ".py",
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".html",
    ".css",
    ".json",
}

EXPLICIT_SOURCE_FILES = {
    "requirements.txt",
}

BINARY_EXTENSIONS = {
    ".npy",
    ".pth",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".ico",
    ".pdf",
    ".bin",
    ".exe",
    ".dll",
    ".so",
    ".dylib",
    ".zip",
    ".tar",
    ".gz",
    ".7z",
    ".pkl",
    ".h5",
    ".parquet",
}


def build_tree(current_dir, prefix=""):
    entries = []
    try:
        items = sorted(os.listdir(current_dir))
    except Exception:
        return []

    filtered_items = []
    for item in items:
        full_path = os.path.join(current_dir, item)
        if os.path.isdir(full_path):
            if item in EXCLUDE_DIRS:
                continue
            filtered_items.append((item, True, full_path))
        else:
            if item in EXCLUDE_FILES:
                continue
            filtered_items.append((item, False, full_path))

    for i, (item, is_dir, full_path) in enumerate(filtered_items):
        is_last = (i == len(filtered_items) - 1)
        connector = "└── " if is_last else "├── "
        entries.append(f"{prefix}{connector}{item}{'/' if is_dir else ''}")
        if is_dir:
            sub_prefix = prefix + ("    " if is_last else "│   ")
            entries.extend(build_tree(full_path, sub_prefix))
    return entries


def is_source_file(rel_path, filename):
    if filename in EXCLUDE_FILES:
        return False
    _, ext = os.path.splitext(filename)
    ext = ext.lower()
    if ext in BINARY_EXTENSIONS:
        return False
    if filename in EXPLICIT_SOURCE_FILES:
        return True
    if ext in SOURCE_EXTENSIONS:
        return True
    return False


def collect_source_files():
    source_files = []
    for root, dirs, files in os.walk(ROOT_DIR):
        dirs[:] = sorted([d for d in dirs if d not in EXCLUDE_DIRS])
        for file in sorted(files):
            full_path = os.path.join(root, file)
            rel_path = os.path.relpath(full_path, ROOT_DIR).replace("\\", "/")
            if is_source_file(rel_path, file):
                source_files.append((rel_path, full_path))
    return source_files


def generate_dump():
    lines = []
    root_name = os.path.basename(ROOT_DIR)

    lines.append("=" * 80)
    lines.append(f"PROJECT FILE TREE: {root_name}")
    lines.append("=" * 80)
    lines.append(f"{root_name}/")
    tree_lines = build_tree(ROOT_DIR)
    lines.extend(tree_lines)
    lines.append("")
    lines.append("=" * 80)
    lines.append("SOURCE FILE CONTENTS")
    lines.append("=" * 80)

    source_files = collect_source_files()
    for rel_path, full_path in source_files:
        lines.append("")
        lines.append("=" * 80)
        lines.append(f"FILE: {rel_path}")
        lines.append("=" * 80)
        try:
            with open(full_path, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
            lines.append(content)
        except Exception as e:
            lines.append(f"[Error reading file: {e}]")

    output_content = "\n".join(lines)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write(output_content)

    print(f"Codebase dump successfully generated at: {OUTPUT_FILE}")
    print(f"Total source files dumped: {len(source_files)}")


if __name__ == "__main__":
    generate_dump()
