#!/usr/bin/env python3
"""Register ARCHIVE PILATES online video products in Imweb.

Default mode is dry-run. Pass --execute to create products.
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
import time
import urllib.error
import urllib.request
from pathlib import Path


API_BASE = "https://api.imweb.me/v2"
DEFAULT_CANDIDATES = (
    Path(__file__).resolve().parents[1]
    / "artifacts"
    / "imweb-online-video-products-2026-06-13"
    / "imweb-online-video-products-candidates.json"
)
KAKAO_CHAT_URL = "http://pf.kakao.com/_AHdvn/chat"
FALLBACK_IMAGE_URL = "https://cdn.imweb.me/upload/S20260516852c71a014d08/0193d9754476a.png"
HIDE_SHIPPING_STYLE = """<style>
._item_detail_wrap .prod-detail-section--select-group,
._item_detail_wrap .prod-detail-section--delivery,
._item_detail_wrap .prod-detail-section--delivery-guide {
  display: none !important;
}
</style>"""


def youtube_thumbnail(video_id: str | None) -> str:
    if not video_id:
        return FALLBACK_IMAGE_URL
    return f"https://i.ytimg.com/vi/{video_id}/maxresdefault.jpg"


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


def list_products(token: str) -> list[dict]:
    result = request("GET", "/shop/products", {"version": "latest", "limit": 100, "offset": 1}, token)
    data = result.get("data") or {}
    return data.get("list") or []


def product_heading(candidate: dict) -> str:
    name = candidate["product_name"]
    return name.replace("[온라인] ", "", 1)


def online_product_content(candidate: dict) -> str:
    title = html.escape(product_heading(candidate))
    teacher = html.escape(candidate.get("teacher") or "ARCHIVE PILATES")
    apparatus = html.escape(candidate.get("apparatus") or "기구")
    topic = html.escape(candidate.get("topic") or "ARCHIVE METHOD")
    duration = html.escape(candidate.get("duration") or "")
    preview_video_id = candidate.get("preview_video_id") or ""
    thumbnail = html.escape(youtube_thumbnail(preview_video_id))

    if preview_video_id:
        preview_block = f"""
  <figure style="margin:24px 0 0;">
    <img src="{thumbnail}" alt="{title} 미리보기 썸네일" style="display:block;width:100%;max-width:960px;border-radius:0;border:1px solid #e8e0d6;">
  </figure>
  <div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;margin:16px 0 26px;background:#111;">
    <iframe src="https://www.youtube.com/embed/{html.escape(preview_video_id)}" title="ARCHIVE PILATES preview" style="position:absolute;inset:0;width:100%;height:100%;border:0;" allowfullscreen></iframe>
  </div>"""
    else:
        preview_block = """
  <div style="padding:18px;border:1px dashed #cfc7ba;color:#4a4038;background:#fbfaf7;margin:22px 0;">미리보기 영상은 준비 중입니다. 구매 전 궁금한 점은 카카오톡 문의로 남겨주세요.</div>"""

    return f"""{HIDE_SHIPPING_STYLE}
<section class="archive-online-product" style="font-family:inherit;line-height:1.75;color:#1f1f1f;">
  <p style="display:inline-block;margin:0 0 14px;padding:7px 10px;background:#f8de59;color:#1f1f1f;font-weight:700;font-size:13px;letter-spacing:0;border:1px solid #e2c83c;">온라인 영상 클래스</p>
  <h2 style="font-size:28px;line-height:1.25;margin:0 0 12px;color:#171717;">{title}</h2>
  <p style="margin:0 0 18px;color:#555;">{teacher} · {apparatus} · {topic} · {duration} · 결제 후 40일 시청 권한</p>
{preview_block}
  <div style="padding:20px;border:1px solid #e7e1d8;background:#fbfaf7;margin:22px 0;">
    <strong style="display:block;margin-bottom:8px;color:#171717;">수업 구성</strong>
    ARCHIVE PILATES 강사레슨에서 사용하는 주제형 시퀀스 풀영상입니다. 수업 흐름, 큐잉, 기구 세팅, 움직임 연결 방식을 복습할 수 있도록 구성했습니다.
  </div>
  <h3 style="font-size:20px;margin:26px 0 10px;color:#171717;">구매 후 이용 안내</h3>
  <ul style="padding-left:20px;margin:0 0 18px;color:#333;">
    <li>결제 완료 후 주문자 계정에 해당 영상 전용 시청 권한을 부여합니다.</li>
    <li>풀영상은 공개 링크로 발송하지 않고, 로그인 후 접근 가능한 임베드 페이지에서 시청합니다.</li>
    <li>시청 가능 기간은 권한 부여일 기준 40일입니다.</li>
    <li>무단 저장, 복제, 공유, 재배포는 금지됩니다.</li>
  </ul>
  <a href="{KAKAO_CHAT_URL}" style="display:inline-block;margin-top:4px;padding:13px 18px;background:#f8de59;color:#171717 !important;text-decoration:none;font-weight:800;border:1px solid #d9be2d;border-radius:0;">카카오톡 문의</a>
</section>"""


def build_payload(candidate: dict, status: str, category_code: str) -> dict:
    preview_video_id = candidate.get("preview_video_id") or None
    return {
        "version": "latest",
        "categories": [category_code],
        "name": candidate["product_name"],
        "simple_content": candidate["simple_content"],
        "content": online_product_content(candidate),
        "images": [youtube_thumbnail(preview_video_id)],
        "prod_status": status,
        "prod_type": "normal",
        "price": candidate["price"],
        "price_tax": True,
        "stock_use": False,
        "stock_unlimit": True,
        "seo_title": candidate["product_name"],
        "seo_description": candidate["simple_content"],
    }


def patch_core_products(token: str, category_code: str) -> None:
    offline_content = f"""{HIDE_SHIPPING_STYLE}
<section class="archive-offline-product" style="font-family:inherit;line-height:1.75;color:#1f1f1f;">
  <p style="display:inline-block;margin:0 0 14px;padding:7px 10px;background:#f8de59;color:#1f1f1f;font-weight:700;font-size:13px;border:1px solid #e2c83c;">오프라인 강사레슨</p>
  <h2 style="font-size:28px;line-height:1.25;margin:0 0 12px;color:#171717;">ARCHIVE METHOD 5:1 강사레슨</h2>
  <p style="margin:0 0 18px;color:#555;">부산 명지 ARCHIVE PILATES에서 진행하는 강사 대상 오프라인 레슨입니다.</p>
  <div style="padding:20px;border:1px solid #e7e1d8;background:#fbfaf7;margin:22px 0;">
    <strong style="display:block;margin-bottom:8px;color:#171717;">진행 방식</strong>
    정해진 ARCHIVE METHOD 흐름을 기준으로 기구 세팅, 큐잉, 움직임 연결, 보상 패턴 관찰을 함께 훈련합니다.
  </div>
  <a href="{KAKAO_CHAT_URL}" style="display:inline-block;margin-top:4px;padding:13px 18px;background:#f8de59;color:#171717 !important;text-decoration:none;font-weight:800;border:1px solid #d9be2d;border-radius:0;">카카오톡 문의</a>
</section>"""
    online_summary_content = f"""{HIDE_SHIPPING_STYLE}
<section class="archive-online-summary-product" style="font-family:inherit;line-height:1.75;color:#1f1f1f;">
  <p style="display:inline-block;margin:0 0 14px;padding:7px 10px;background:#f8de59;color:#1f1f1f;font-weight:700;font-size:13px;border:1px solid #e2c83c;">온라인 영상 클래스</p>
  <h2 style="font-size:28px;line-height:1.25;margin:0 0 12px;color:#171717;">ARCHIVE METHOD 영상 클래스</h2>
  <p style="margin:0 0 18px;color:#555;">영상별 개별 상품을 선택해 결제하고, 구매자 계정에 전용 임베드 페이지 시청 권한을 부여하는 방식입니다.</p>
  <div style="padding:20px;border:1px solid #e7e1d8;background:#fbfaf7;margin:22px 0;">
    <strong style="display:block;margin-bottom:8px;color:#171717;">시청 방식</strong>
    풀영상 링크를 공개 발송하지 않습니다. 결제 후 로그인 가능한 구매자 전용 페이지에서 임베드 영상으로 시청합니다.
  </div>
  <ul style="padding-left:20px;margin:0 0 18px;color:#333;">
    <li>영상 1편 기준 15,000원</li>
    <li>시청 가능 기간은 권한 부여일 기준 40일</li>
    <li>무단 저장, 복제, 공유, 재배포 금지</li>
  </ul>
  <a href="{KAKAO_CHAT_URL}" style="display:inline-block;margin-top:4px;padding:13px 18px;background:#f8de59;color:#171717 !important;text-decoration:none;font-weight:800;border:1px solid #d9be2d;border-radius:0;">카카오톡 문의</a>
</section>"""
    updates = {
        1: {
            "name": "[오프라인] ARCHIVE METHOD 5:1 강사레슨",
            "content": offline_content,
            "simple_content": "부산 명지 ARCHIVE PILATES 5:1 강사 대상 오프라인 레슨",
        },
        2: {
            "name": "[온라인] ARCHIVE METHOD 영상 클래스",
            "content": online_summary_content,
            "simple_content": "영상별 개별 상품 결제 후 구매자 전용 임베드 페이지 시청 권한 부여",
        },
    }
    for product_no, payload in updates.items():
        payload.update({"version": "latest", "categories": [category_code]})
        result = request("PATCH", f"/shop/products/{product_no}", payload, token)
        code = result.get("code")
        msg = result.get("msg")
        print(f"PATCH core_product={product_no} code={code} msg={msg}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidates", type=Path, default=DEFAULT_CANDIDATES)
    parser.add_argument("--execute", action="store_true", help="Actually create products in Imweb.")
    parser.add_argument("--status", default="nosale", choices=["nosale", "sale", "soldout"])
    parser.add_argument("--category-code", help="Imweb product category code. Required with --execute.")
    parser.add_argument("--patch-core-products", action="store_true", help="Patch product 1/2 CTA colors and online access wording.")
    parser.add_argument("--sleep", type=float, default=0.4, help="Seconds to wait between write calls.")
    args = parser.parse_args()

    candidates = json.loads(args.candidates.read_text(encoding="utf-8"))
    print(f"candidates={len(candidates)}")
    if not args.execute:
        for candidate in candidates:
            payload = build_payload(candidate, args.status, args.category_code or "CATEGORY_CODE")
            print(f"DRY-RUN create status={args.status} image={payload['images'][0]} name={candidate['product_name']}")
        return 0

    if args.execute and not args.category_code:
        raise SystemExit("Pass --category-code with the Imweb online lesson category code.")

    token = get_token()
    if args.patch_core_products:
        patch_core_products(token, args.category_code)
        time.sleep(args.sleep)

    existing_names = {product.get("name") for product in list_products(token)}
    created = 0
    skipped = 0
    for candidate in candidates:
        if candidate["product_name"] in existing_names:
            print(f"SKIP existing name={candidate['product_name']}")
            skipped += 1
            continue
        result = request("POST", "/shop/products", build_payload(candidate, args.status, args.category_code), token)
        code = result.get("code")
        msg = result.get("msg")
        if code not in (1, 200):
            print(f"FAIL code={code} msg={msg} name={candidate['product_name']}")
            continue
        print(f"CREATE code={code} msg={msg} name={candidate['product_name']}")
        created += 1
        time.sleep(args.sleep)
    print(f"created={created} skipped={skipped}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
