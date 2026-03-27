"""
Generate docs/user-guide.html and insert Help links in WebPortal modules.

Maintained implementation: node scripts/apply_user_guide_help_links.mjs
(Python copy may drift; use Node on Windows if python is not on PATH.)
"""
from __future__ import annotations

import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
DOCS = REPO / "docs" / "user-guide.html"
WEBPORTAL_MODULES = REPO / "WebPortal" / "modules"

HELP_BTN_TOOLBAR = (
    '<a href="../docs/user-guide.html#{anchor}" target="_blank" rel="noopener noreferrer" '
    'class="btn btn-sm btn-outline-secondary me-2" title="User guide">'
    '<i class="fas fa-circle-question me-1"></i>Help</a>'
)
HELP_BTN_MODAL = HELP_BTN_TOOLBAR.replace("me-2", "ms-auto me-2")
HELP_BTN_LIGHT = HELP_BTN_MODAL.replace("outline-secondary", "outline-light")

MODAL_TITLE_CLOSE = re.compile(
    r'(<h5 class="modal-title"[^>]*>.*?</h5>)(\s*)(<button[^>]*class="btn-close)',
    re.DOTALL,
)


def modal_anchor(stem: str) -> str:
    if stem.startswith("modal_"):
        return "modal-" + stem[6:].replace("_", "-")
    return stem.replace("_", "-")


def grid_anchor(stem: str) -> str:
    return stem.replace("_", "-")


def patch_modal(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    if "docs/user-guide.html" in text:
        return False
    anchor = modal_anchor(path.stem)
    use_light = "btn-close-white" in text
    link = (HELP_BTN_LIGHT if use_light else HELP_BTN_MODAL).format(anchor=anchor)

    def repl(m: re.Match) -> str:
        return f"{m.group(1)}{m.group(2)}{link}{m.group(2)}{m.group(3)}"

    new_text, n = MODAL_TITLE_CLOSE.subn(repl, text, count=1)
    if n != 1:
        return False
    path.write_text(new_text, encoding="utf-8", newline="\n")
    return True


def prepend_to_first_btn_toolbar(text: str, link_line: str) -> tuple[str, bool]:
    m = re.search(r'(<div class="btn-toolbar[^"]*"[^>]*>\s*)', text)
    if not m:
        return text, False
    insert_at = m.end()
    return text[:insert_at] + link_line + text[insert_at:], True


def patch_dashboard_unified(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    if "docs/user-guide.html#dashboard-overview" in text:
        return False

    def link(anchor: str) -> str:
        return HELP_BTN_TOOLBAR.format(anchor=anchor).strip()

    old1 = """            <h1 class="h2 mb-0">Dashboard Overview</h1>
        </div>"""
    new1 = f"""            <h1 class="h2 mb-0">Dashboard Overview</h1>
            <div class="btn-toolbar mb-2 mb-md-0">
                {link("dashboard-overview")}
            </div>
        </div>"""
    if old1 not in text:
        return False
    text = text.replace(old1, new1, 1)

    old2 = """            <div class="btn-toolbar mb-2 mb-md-0">
                <button type="button" class="btn btn-secondary" id="refreshBtn">"""
    new2 = f"""            <div class="btn-toolbar mb-2 mb-md-0">
                {link("material-journey-dashboard")}
                <button type="button" class="btn btn-secondary" id="refreshBtn">"""
    text = text.replace(old2, new2, 1)

    old3 = """            <div class="btn-toolbar mb-2 mb-md-0">
                <button type="button" class="btn btn-outline-secondary me-2" id="customizeDashboardBtn" """
    new3 = f"""            <div class="btn-toolbar mb-2 mb-md-0">
                {link("executive-dashboard")}
                <button type="button" class="btn btn-outline-secondary me-2" id="customizeDashboardBtn" """
    text = text.replace(old3, new3, 1)

    path.write_text(text, encoding="utf-8", newline="\n")
    return True


def patch_role_grids_unified(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    if "docs/user-guide.html#roles-grid" in text:
        return False

    def link(anchor: str) -> str:
        return HELP_BTN_TOOLBAR.format(anchor=anchor).strip()

    reps = [
        (
            """            <div class="btn-toolbar mb-2 mb-md-0 ms-auto">
                <button type="button" class="btn btn-outline-secondary" id="rolesExportBtn">""",
            f"""            <div class="btn-toolbar mb-2 mb-md-0 ms-auto">
                {link("roles-grid")}
                <button type="button" class="btn btn-outline-secondary" id="rolesExportBtn">""",
        ),
        (
            """            <div class="btn-toolbar mb-2 mb-md-0 ms-auto">
                <button type="button" class="btn btn-outline-secondary" id="exportPermissionsBtn">""",
            f"""            <div class="btn-toolbar mb-2 mb-md-0 ms-auto">
                {link("role-permissions-grid")}
                <button type="button" class="btn btn-outline-secondary" id="exportPermissionsBtn">""",
        ),
        (
            """            <div class="btn-toolbar mb-2 mb-md-0 ms-auto">
                <button type="button" class="btn btn-outline-secondary" id="refreshFeaturesBtn">""",
            f"""            <div class="btn-toolbar mb-2 mb-md-0 ms-auto">
                {link("role-features-grid")}
                <button type="button" class="btn btn-outline-secondary" id="refreshFeaturesBtn">""",
        ),
    ]
    for old, new in reps:
        if old not in text:
            return False
        text = text.replace(old, new, 1)
    path.write_text(text, encoding="utf-8", newline="\n")
    return True


def patch_supply_chain_flow(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    if "docs/user-guide.html" in text:
        return False
    old = """        <div class="btn-toolbar mb-2 mb-md-0">
            <a href="#" route="grower-intake-grid" """
    link = HELP_BTN_TOOLBAR.format(anchor="supply-chain-flow").strip()
    new = f"""        <div class="btn-toolbar mb-2 mb-md-0">
            {link}
            <a href="#" route="grower-intake-grid" """
    if old not in text:
        return False
    path.write_text(text.replace(old, new, 1), encoding="utf-8", newline="\n")
    return True


def patch_dispatch_header(path: Path, anchor: str) -> bool:
    text = path.read_text(encoding="utf-8")
    if "docs/user-guide.html" in text:
        return False
    old = """        <div class="d-flex align-items-center gap-2">
            <div class="view-toggle">"""
    link = HELP_BTN_TOOLBAR.format(anchor=anchor).strip()
    new = f"""        <div class="d-flex align-items-center gap-2">
            {link}
            <div class="view-toggle">"""
    if old not in text:
        return False
    path.write_text(text.replace(old, new, 1), encoding="utf-8", newline="\n")
    return True


def patch_my_day(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    if "docs/user-guide.html" in text:
        return False
    old = """<div class="my-day-container">
    <div id="my-day-container">"""
    link = HELP_BTN_TOOLBAR.format(anchor="my-day").strip()
    new = f"""<div class="my-day-container">
    <div class="d-flex justify-content-end px-3 pt-3 pb-0">
        {link}
    </div>
    <div id="my-day-container">"""
    if old not in text:
        return False
    path.write_text(text.replace(old, new, 1), encoding="utf-8", newline="\n")
    return True


def patch_generic_grid(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    if "docs/user-guide.html" in text:
        return False
    anchor = grid_anchor(path.stem)
    link_line = HELP_BTN_TOOLBAR.format(anchor=anchor).strip() + "\n            "
    new_text, ok = prepend_to_first_btn_toolbar(text, link_line)
    if ok:
        path.write_text(new_text, encoding="utf-8", newline="\n")
        return True
    return False


def human_title(aid: str) -> str:
    return aid.replace("-", " ").title()


def build_user_guide_html(anchors: dict[str, str]) -> str:
    sections = []
    for aid in sorted(anchors.keys(), key=lambda x: anchors[x].lower()):
        title = anchors[aid]
        desc = f"User-facing documentation for this area. Deep link: #{aid}."
        sections.append(
            f'  <section id="{aid}">\n    <h2>{title}</h2>\n    <p>{desc}</p>\n  </section>\n'
        )
    body = "\n".join(sections)
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Macavation User Guide</title>
  <style>
    body {{ font-family: system-ui, sans-serif; max-width: 52rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }}
    section {{ border-bottom: 1px solid #ddd; padding-bottom: 1.25rem; margin-bottom: 1.25rem; }}
    h1 {{ color: #2d4a3e; }}
  </style>
</head>
<body>
  <h1>Macavation User Guide</h1>
  <p>In-app <strong>Help</strong> opens this page at the matching section. Extend each section as features grow.</p>

{body}
</body>
</html>
"""


def collect_all_anchors() -> dict[str, str]:
    """anchor id -> section title"""
    m: dict[str, str] = {}

    def add(aid: str, title: str) -> None:
        m[aid] = title

    for p in WEBPORTAL_MODULES.rglob("html/*_grid.html"):
        if not p.is_file():
            continue
        aid = grid_anchor(p.stem)
        add(aid, human_title(aid).replace(" Grid", "").strip() + " (module)")

    data_import = WEBPORTAL_MODULES / "data-import" / "html" / "data_import_grid.html"
    if data_import.is_file():
        add("data-import-grid", "Data import (module)")

    add("supply-chain-flow", "Supply chain &amp; process flow")
    add("my-day", "My day (module)")
    add("dashboard-overview", "Dashboard overview")
    add("material-journey-dashboard", "Material journey dashboard")
    add("executive-dashboard", "Executive dashboard &amp; reporting")
    add("roles-grid", "Roles (module)")
    add("role-permissions-grid", "Role permissions (module)")
    add("role-features-grid", "Role features (module)")

    for p in WEBPORTAL_MODULES.glob("modals/*/html/modal_*.html"):
        aid = modal_anchor(p.stem)
        add(aid, human_title(aid.replace("modal-", "")) + " (dialog)")

    return m


def main() -> None:
    meta = collect_all_anchors()
    DOCS.write_text(build_user_guide_html(meta), encoding="utf-8", newline="\n")

    patched = 0
    failed_modals: list[str] = []

    du = WEBPORTAL_MODULES / "dashboard" / "html" / "dashboard_unified.html"
    if du.is_file() and patch_dashboard_unified(du):
        patched += 1

    for folder in ("roles", "role-permissions", "role-features"):
        rp = WEBPORTAL_MODULES / folder / "html" / "role_grids_unified.html"
        if rp.is_file() and patch_role_grids_unified(rp):
            patched += 1

    sc = WEBPORTAL_MODULES / "supply-chain-flow" / "html" / "supply_chain_flow.html"
    if sc.is_file() and patch_supply_chain_flow(sc):
        patched += 1

    kd = WEBPORTAL_MODULES / "kernel-dispatch" / "html" / "kernel_dispatch_grid.html"
    if kd.is_file() and patch_dispatch_header(kd, "kernel-dispatch-grid"):
        patched += 1

    od = WEBPORTAL_MODULES / "oil-dispatch" / "html" / "oil_dispatch_grid.html"
    if od.is_file() and patch_dispatch_header(od, "oil-dispatch-grid"):
        patched += 1

    my_day = WEBPORTAL_MODULES / "my-day" / "html" / "my_day.html"
    if my_day.is_file() and patch_my_day(my_day):
        patched += 1

    dispatch_stems = {"kernel_dispatch_grid", "oil_dispatch_grid"}
    for p in WEBPORTAL_MODULES.rglob("html/*_grid.html"):
        if p.stem in dispatch_stems:
            continue
        if patch_generic_grid(p):
            patched += 1

    di = WEBPORTAL_MODULES / "data-import" / "html" / "data_import_grid.html"
    if di.is_file() and "docs/user-guide.html" not in di.read_text(encoding="utf-8"):
        if patch_generic_grid(di):
            patched += 1

    for p in sorted(WEBPORTAL_MODULES.glob("modals/*/html/modal_*.html")):
        if patch_modal(p):
            patched += 1
        elif "docs/user-guide.html" not in p.read_text(encoding="utf-8"):
            failed_modals.append(str(p.relative_to(REPO)))

    print(f"Wrote {DOCS.relative_to(REPO)}")
    print(f"Patched {patched} files.")
    if failed_modals:
        print("Modals not patched (unexpected header markup):")
        for f in failed_modals:
            print(" ", f)


if __name__ == "__main__":
    main()
