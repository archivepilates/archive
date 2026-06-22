#!/usr/bin/env python3
"""Create one Imweb subscribe product for ARCHIVE PILATES access testing.

Credentials are read from environment variables only:
  IMWEB_API_KEY
  IMWEB_SECRET_KEY
"""

from __future__ import annotations

import argparse
import html
import json
import os
import sys
import urllib.error
import urllib.request


API_BASE = "https://api.imweb.me/v2"
DEFAULT_IMAGE_URL = "https://cdn.imweb.me/upload/S20260516852c71a014d08/0193d9754476a.png"


def request(method: str, path: str, payload: dict | None = None, token: str | None = None) -> dict:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["access-token"] = token
    body = json.dumps(payload or {}, ensure_ascii=False).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(API_BASE + path, data=body, headers=headers, method=method)
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


def get_token() -> str:
    api_key = os.environ.get("IMWEB_API_KEY")
    secret_key = os.environ.get("IMWEB_SECRET_KEY")
    if not api_key or not secret_key:
        raise SystemExit("Set IMWEB_API_KEY and IMWEB_SECRET_KEY in the environment.")
    result = request("POST", "/auth", {"key": api_key, "secret": secret_key})
    token = result.get("access_token")
    if not token:
        raise SystemExit(f"Imweb auth failed: {result}")
    return token


def build_content(group_name: str, period: int) -> str:
    safe_group = html.escape(group_name)
    return f"""
<section class="archive-subscribe-test-product" style="font-family:inherit;line-height:1.75;color:#1f1f1f;">
  <p style="display:inline-block;margin:0 0 14px;padding:7px 10px;background:#f8de59;color:#171717;font-weight:800;border:1px solid #d9be2d;">회원그룹 이용권 테스트</p>
  <h2 style="font-size:28px;line-height:1.25;margin:0 0 12px;color:#171717;">ARCHIVE PILATES 영상 권한 테스트</h2>
  <p style="margin:0 0 18px;color:#555;">구매 완료 후 <strong>{safe_group}</strong> 그룹이 {period}일 동안 자동 부여되는지 확인하는 테스트 상품입니다.</p>
  <div style="padding:20px;border:1px solid #e7e1d8;background:#fbfaf7;margin:22px 0;">
    실제 운영에서는 이 상품을 영상별 회원그룹 이용권으로 만들고, 해당 그룹만 접근 가능한 구매자 전용 시청 페이지에 YouTube 풀영상을 임베드합니다.
  </div>
</section>
""".strip()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--category-code", required=True)
    parser.add_argument("--group-code", required=True)
    parser.add_argument("--group-name", default="ARCHIVE TEST 40D VIDEO")
    parser.add_argument("--name", default="[TEST] ARCHIVE 40D 영상 권한 테스트")
    parser.add_argument("--period", type=int, default=40)
    parser.add_argument("--price", type=float, default=0)
    parser.add_argument("--status", default="sale", choices=["sale", "nosale", "soldout"])
    parser.add_argument("--image-url", default=DEFAULT_IMAGE_URL)
    args = parser.parse_args()

    payload = {
        "version": "latest",
        "categories": [args.category_code],
        "images": [args.image_url],
        "name": args.name,
        "simple_content": f"{args.group_name} {args.period}일 자동 부여 테스트",
        "content": build_content(args.group_name, args.period),
        "prod_status": args.status,
        "prod_type": "subscribe",
        "subscribe_group_code": args.group_code,
        "subscribe_period": args.period,
        "price": args.price,
        "price_none": False,
        "price_tax": True,
        "stock_use": False,
        "stock_unlimit": True,
        "seo_title": args.name,
        "seo_description": f"{args.group_name} {args.period}일 자동 부여 테스트",
    }
    token = get_token()
    result = request("POST", "/shop/products", payload, token)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
