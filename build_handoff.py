import os
import json

IGNORE_DIRS = {'.git', '__pycache__', 'node_modules', '.venv', 'venv', 'env', '.ipynb_checkpoints', 'artifacts', 'data', 'PS-RGB', 'masks'}
CODE_EXTENSIONS = {'.py', '.js', '.jsx', '.ts', '.tsx', '.css', '.html', '.md'}
OUTPUT_FILE = "full_project_handoff.txt"

def extract_clean_ipynb(filepath):
    """Extracts pure code and markdown from .ipynb, stripping massive Base64 images."""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            nb = json.load(f)
        out = []
        for idx, cell in enumerate(nb.get('cells', [])):
            ctype = cell.get('cell_type', '')
            source = ''.join(cell.get('source', []))
            if not source.strip():
                continue
            if ctype == 'markdown':
                out.append(f"# --- [Markdown Cell {idx+1}] ---\n{source}\n")
            elif ctype == 'code':
                out.append(f"# --- [Code Cell {idx+1}] ---\n{source}\n")
                for output in cell.get('outputs', []):
                    if 'text' in output:
                        text_out = ''.join(output['text'])
                        if len(text_out) < 1500:
                            out.append(f"'''\n[Cell {idx+1} Output]:\n{text_out.strip()}\n'''\n")
        return '\n'.join(out)
    except Exception as e:
        return f"# Error parsing notebook {filepath}: {e}"

def build_handoff():
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as out:
        # 1. Inject PROJECT_BRAIN.md first so the AI loads our tactical memory instantly
        if os.path.exists("PROJECT_BRAIN.md"):
            with open("PROJECT_BRAIN.md", 'r', encoding='utf-8') as brain:
                out.write(brain.read() + "\n\n" + "="*80 + "\n\n")

        # 2. Walk directory and dump all code + cleaned notebooks (skipping README.md since brain already covers project context)
        for root, dirs, files in os.walk("."):
            dirs[:] = [d for d in dirs if d not in IGNORE_DIRS]
            for file in sorted(files):
                if file in {OUTPUT_FILE, "PROJECT_BRAIN.md", "codedump.txt", "build_handoff.py", "README.md"}:
                    continue
                ext = os.path.splitext(file)[1].lower()
                filepath = os.path.join(root, file)

                if ext in CODE_EXTENSIONS:
                    out.write(f"\n{'='*80}\nFILE: {filepath}\n{'='*80}\n")
                    try:
                        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                            out.write(f.read() + "\n")
                    except Exception as e:
                        out.write(f"# Error reading {filepath}: {e}\n")

                elif ext == '.ipynb':
                    out.write(f"\n{'='*80}\nNOTEBOOK (CLEANED): {filepath}\n{'='*80}\n")
                    out.write(extract_clean_ipynb(filepath) + "\n")

    print(f"[SUCCESS] Clean project handoff generated: {OUTPUT_FILE}")

if __name__ == "__main__":
    build_handoff()