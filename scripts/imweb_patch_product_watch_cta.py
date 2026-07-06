#!/usr/bin/env python3
"""Patch Imweb product detail content with visible buyer watch-page CTAs.

This script uses the locally authenticated Imweb CLI so API credentials never
need to be printed or passed through the command line.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
IMWEB = Path("/Users/archivepilates/.local/bin/imweb")
DEFAULT_MANIFEST = ROOT / "artifacts/imweb-watch-page-widgets-2026-07-01/manifest.json"
DEFAULT_ARTIFACT_DIR = ROOT / "artifacts/imweb-product-watch-cta-2026-07-01"
V2_API_BASE = "https://api.imweb.me/v2"

OLD_BLOCK_RE = re.compile(
    r"\n?<div\s+data-archive-pilates-(?:native-pass|watch-cta)=\"[^\"]*\"[\s\S]*?</div>\s*",
    re.IGNORECASE,
)
SUBTITLE_RE = re.compile(
    r"(<p\s+style=\"margin:0 0 18px;color:#555;\">[\s\S]*?</p>)",
    re.IGNORECASE,
)


def run_json(cmd: list[str]) -> dict:
    completed = subprocess.run(cmd, check=True, text=True, capture_output=True)
    try:
        return json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Command did not return JSON: {' '.join(cmd)}\n{completed.stdout}") from exc


def run(cmd: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, check=True, text=True, capture_output=True)


def v2_request(method: str, path: str, payload: dict | None = None, token: str | None = None) -> dict:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["access-token"] = token
    body = json.dumps(payload or {}, ensure_ascii=False).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(V2_API_BASE + path, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        text = exc.read().decode("utf-8", "replace")
        try:
            detail = json.loads(text)
        except json.JSONDecodeError:
            detail = {"raw": text}
        raise RuntimeError(f"{method} {path} failed: HTTP {exc.code} {detail}") from exc


def get_v2_token() -> str:
    api_key = os.environ.get("IMWEB_API_KEY")
    secret_key = os.environ.get("IMWEB_SECRET_KEY")
    if not api_key or not secret_key:
        raise SystemExit("Set IMWEB_API_KEY and IMWEB_SECRET_KEY for --transport legacy-v2.")
    result = v2_request("POST", "/auth", {"key": api_key, "secret": secret_key})
    token = result.get("access_token")
    if not token:
        raise RuntimeError(f"Imweb v2 auth failed: {result}")
    return token


def get_product(product_no: int) -> dict:
    result = run_json([str(IMWEB), "--output", "json", "product", "get", str(product_no)])
    data = result.get("data")
    if not isinstance(data, dict):
        raise RuntimeError(f"Unexpected product response for {product_no}: {result}")
    return data


def watch_cta(entry: dict) -> str:
    code = entry["code"]
    group_title = entry["groupTitle"]
    href = f"https://archivepilates.imweb.me{entry['watchPath']}"
    return f"""
  <div data-archive-pilates-watch-cta="2026-07-01" style="margin:18px 0 24px;padding:20px 22px;border:1px solid #1e1b18;background:#fffdfa;color:#1f1f1f;line-height:1.75;">
    <strong style="display:block;margin:0 0 8px;font-size:20px;line-height:1.35;color:#171717;">구매 후 시청 페이지</strong>
    <p style="margin:0 0 12px;color:#333;">결제 완료 후 구매 계정에 <strong>{group_title}</strong> 권한이 자동 부여됩니다. 마이페이지 &gt; 주문조회에서 이 상품 상세를 다시 열고 아래 버튼으로 시청 페이지에 접속할 수 있습니다.</p>
    <p style="margin:0 0 14px;color:#6b625b;font-size:14px;">비회원 또는 미구매 계정은 로그인/권한 확인 화면으로 이동합니다. 시청 권한 유지 기간은 결제 후 40일입니다.</p>
    <a href="{href}" style="display:inline-block;min-height:44px;padding:13px 18px;background:#1e1b18;color:#fff !important;text-decoration:none;font-weight:800;border:1px solid #1e1b18;border-radius:0;">{code} 구매 후 시청 페이지 열기</a>
  </div>""".rstrip()


def patch_content(content: str, entry: dict) -> tuple[str, str]:
    cleaned = OLD_BLOCK_RE.sub("\n", content).strip()
    block = watch_cta(entry)
    match = SUBTITLE_RE.search(cleaned)
    if match:
        insert_at = match.end()
        patched = f"{cleaned[:insert_at]}\n{block}{cleaned[insert_at:]}"
        return patched, "after_subtitle"

    section_match = re.search(r"(<section[^>]*class=\"archive-online-product\"[^>]*>)", cleaned, re.IGNORECASE)
    if section_match:
        insert_at = section_match.end()
        patched = f"{cleaned[:insert_at]}\n{block}{cleaned[insert_at:]}"
        return patched, "after_section_open"

    return f"{block}\n{cleaned}", "content_top"


def payload_for(product: dict, content: str) -> dict:
    payload = {
        "version": "latest",
        "content": content,
    }
    unit_code = product.get("unitCode")
    if unit_code:
        payload["unitCode"] = unit_code
    return payload


def legacy_payload(payload: dict) -> dict:
    copied = dict(payload)
    copied.pop("unitCode", None)
    return copied


def update_product(product_no: int, payload_file: Path, dry_run_file: Path) -> dict:
    dry = run_json(
        [
            str(IMWEB),
            "--output",
            "json",
            "api",
            "PATCH",
            f"/shop/products/{product_no}",
            "--data",
            f"@{payload_file}",
            "--dry-run",
        ]
    )
    dry_run_file.write_text(json.dumps(dry, ensure_ascii=False, indent=2), encoding="utf-8")
    token = dry.get("confirmation_token") or dry.get("safety", {}).get("confirmation_token")
    bulk = dry.get("bulk_confirmation_token") or dry.get("safety", {}).get("bulk_confirmation_token")
    if not token:
        raise RuntimeError(f"No confirmation token in dry-run for product {product_no}")
    cmd = [
        str(IMWEB),
        "--output",
        "json",
        "api",
        "PATCH",
        f"/shop/products/{product_no}",
        "--data",
        f"@{payload_file}",
        "--yes",
        "--confirm-token",
        token,
    ]
    if bulk:
        cmd.extend(["--bulk-confirm-token", bulk])
    applied = run_json(cmd)
    return applied


def update_product_v2(product_no: int, payload: dict, token: str) -> dict:
    return v2_request("PATCH", f"/shop/products/{product_no}", legacy_payload(payload), token)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--artifact-dir", type=Path, default=DEFAULT_ARTIFACT_DIR)
    parser.add_argument("--apply", action="store_true", help="Apply live Imweb product updates.")
    parser.add_argument(
        "--transport",
        choices=["cli", "legacy-v2"],
        default="cli",
        help="Write transport. legacy-v2 uses IMWEB_API_KEY/IMWEB_SECRET_KEY and the older product API.",
    )
    parser.add_argument("--sleep", type=float, default=0.25)
    args = parser.parse_args()

    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    args.artifact_dir.mkdir(parents=True, exist_ok=True)

    backups: list[dict] = []
    summary: list[dict] = []
    results: list[dict] = []
    v2_token = get_v2_token() if args.apply and args.transport == "legacy-v2" else None

    for entry in manifest:
        product_no = int(entry["productNo"])
        product = get_product(product_no)
        old_content = product.get("content") or ""
        new_content, placement = patch_content(old_content, entry)
        changed = new_content != old_content
        payload = payload_for(product, new_content)
        payload_file = args.artifact_dir / f"product-{product_no}-{entry['code'].lower()}-payload.json"
        payload_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

        backups.append(
            {
                "productNo": product_no,
                "code": entry["code"],
                "name": product.get("name"),
                "content": old_content,
            }
        )
        item = {
            "productNo": product_no,
            "code": entry["code"],
            "name": product.get("name"),
            "watchPath": entry["watchPath"],
            "groupTitle": entry["groupTitle"],
            "placement": placement,
            "changed": changed,
            "oldContentLength": len(old_content),
            "newContentLength": len(new_content),
            "oldNativePass": "data-archive-pilates-native-pass" in old_content,
            "oldWatchCta": "data-archive-pilates-watch-cta" in old_content,
            "newWatchCta": "data-archive-pilates-watch-cta=\"2026-07-01\"" in new_content,
            "newWatchPath": entry["watchPath"] in new_content,
            "payloadFile": str(payload_file),
        }
        summary.append(item)

        if args.apply and changed:
            if args.transport == "legacy-v2":
                dry_run_file = None
                applied = update_product_v2(product_no, payload, v2_token or "")
            else:
                dry_run_file = args.artifact_dir / f"product-{product_no}-{entry['code'].lower()}-dry-run.json"
                applied = update_product(product_no, payload_file, dry_run_file)
            results.append(
                {
                    "productNo": product_no,
                    "code": entry["code"],
                    "statusCode": applied.get("statusCode"),
                    "codeValue": applied.get("code"),
                    "msg": applied.get("msg"),
                    "transport": args.transport,
                    "dryRunFile": str(dry_run_file) if dry_run_file else None,
                }
            )
            time.sleep(args.sleep)

    (args.artifact_dir / "product-content-before.json").write_text(
        json.dumps(backups, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (args.artifact_dir / "product-watch-cta-plan.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    if args.apply:
        (args.artifact_dir / "product-watch-cta-apply-results.json").write_text(
            json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    changed_count = sum(1 for item in summary if item["changed"])
    print(
        json.dumps(
            {
                "products": len(summary),
                "changed": changed_count,
                "apply": args.apply,
                "transport": args.transport,
                "artifactDir": str(args.artifact_dir),
                "allHaveNewCta": all(item["newWatchCta"] and item["newWatchPath"] for item in summary),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
