#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Grant ARCHIVE PILATES online video buyer access from Imweb orders.

Default mode is read-only. Use --apply only after reviewing the plan output.

The script intentionally keeps logs low-PII: order numbers, product numbers,
video codes, and status only. Email/member uid values are used only for the
API call and optional delivery queue file.
"""

from __future__ import annotations

import argparse
import base64
import json
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
IMWEB = Path("/Users/archivepilates/.local/bin/imweb")
STATE_DIR = ROOT / "artifacts" / "imweb-buyer-video-access"
STATE_FILE = STATE_DIR / "state.json"
DELIVERY_QUEUE_FILE = STATE_DIR / "pending-deliveries.jsonl"
SIGNUP_QUEUE_FILE = STATE_DIR / "pending-signup-notices.jsonl"
YOUTUBE_READY_FILE = STATE_DIR / "youtube-ready-codes.json"
DEFAULT_YOUTUBE_READY_CODES = {"AB4"}


@dataclass(frozen=True)
class VideoProduct:
    prod_no: int
    code: str
    title: str
    duration: str
    youtube_video_id: str
    group_title: str
    group_code: str

    @property
    def watch_path(self) -> str:
        return f"/archive-method-watch-{self.code.lower()}"

    @property
    def watch_url(self) -> str:
        return f"https://archivepilates.imweb.me{self.watch_path}"

    @property
    def product_url(self) -> str:
        return f"https://archivepilates.imweb.me/shop_view/{self.prod_no}"


VIDEO_PRODUCTS: list[VideoProduct] = [
    VideoProduct(28, "ACH7", "체어 흉추가동성", "46:41", "UR2c0z7op8M", "ARCHIVE METHOD ACH7 40D", "g202606280088d48c168dd"),
    VideoProduct(29, "ACA4", "캐딜락 고강도 필라테스", "50:50", "2nfEIKt92Bc", "ARCHIVE METHOD ACA4 40D", "g202606286a5f40cd97cff"),
    VideoProduct(30, "AB7", "바렐", "50:07", "FZ960TW_GmU", "ARCHIVE METHOD AB7 40D", "g2026062844c875efbe83d"),
    VideoProduct(31, "AR3", "리포머", "54:34", "VzNiehvLZdk", "ARCHIVE METHOD AR3 40D", "g20260628d909ece7b18d4"),
    VideoProduct(32, "AB6", "바렐", "48:40", "xPQM4kuDb4o", "ARCHIVE METHOD AB6 40D", "g202606284da349b19a03c"),
    VideoProduct(33, "ACH6", "체어", "58:20", "7iYTJQ1fdGM", "ARCHIVE METHOD ACH6 40D", "g20260628f72b1c85bfa18"),
    VideoProduct(50, "ACH8", "체어 호흡", "01:00:50", "_pTvw4neHZk", "ARCHIVE METHOD ACH8 40D", "g2026062956772b09976a1"),
    VideoProduct(34, "AR2-1", "리포머", "46:24", "8a9y3T-9ZZE", "ARCHIVE METHOD AR2-1 40D", "g202606287f9e5ff5d4a21"),
    VideoProduct(35, "ACH5", "체어", "52:20", "uDttiPcoLJM", "ARCHIVE METHOD ACH5 40D", "g2026062882ccaeca13ec3"),
    VideoProduct(36, "ACA2", "캐딜락", "59:11", "5gNW6DS1ITc", "ARCHIVE METHOD ACA2 40D", "g202606282754ea4191b73"),
    VideoProduct(37, "ACA3", "캐딜락 고강도 필라테스", "57:46", "6U0HhZPgalo", "ARCHIVE METHOD ACA3 40D", "g202606288eb28ae436e92"),
    VideoProduct(51, "ACA5", "캐딜락 호흡", "53:56", "ranZEI7SAYg", "ARCHIVE METHOD ACA5 40D", "g202606290bc066cba328e"),
    VideoProduct(38, "ACA1", "캐딜락", "58:42", "WE5qk_28gRc", "ARCHIVE METHOD ACA1 40D", "g20260628d8695c0317b89"),
    VideoProduct(39, "AB3", "바렐", "53:30", "UrNS7WfkMWc", "ARCHIVE METHOD AB3 40D", "g20260628f4948711ee506"),
    VideoProduct(40, "ACH2", "체어", "51:38", "LhfM0aHhp-A", "ARCHIVE METHOD ACH2 40D", "g202606289e121e49cda3a"),
    VideoProduct(41, "AB2", "바렐", "52:57", "tTPd8uZbzxs", "ARCHIVE METHOD AB2 40D", "g202606288c436b61462d1"),
    VideoProduct(42, "ACH1", "체어", "50:57", "TmUz69gWVJs", "ARCHIVE METHOD ACH1 40D", "g202606283c4a5a9fb9d58"),
    VideoProduct(43, "ACH4", "체어", "53:45", "Pj5u4pAB2OQ", "ARCHIVE METHOD ACH4 40D", "g20260628b653d3fe5713d"),
    VideoProduct(44, "ACH3", "체어", "55:52", "f4qKBcQfwDI", "ARCHIVE METHOD ACH3 40D", "g20260628dee74ff7404b2"),
    VideoProduct(45, "AB5", "바렐", "53:09", "B8fCeYATptE", "ARCHIVE METHOD AB5 40D", "g20260628bfc1f7dd5bb5f"),
    VideoProduct(46, "AB1", "바렐", "51:27", "bp-DZ_UEwFo", "ARCHIVE METHOD AB1 40D", "g2026062817b8d0582b57e"),
    VideoProduct(27, "AR1", "리포머 척추 정렬 & 코어 컨트롤", "56:49", "hqmbqTHgO6s", "ARCHIVE METHOD AR1 40D", "g2026062802f1f8a665b83"),
    VideoProduct(47, "AR4", "리포머 순환", "51:59", "RSJpy2ncQPE", "ARCHIVE METHOD AR4 40D", "g202606288f208548cea6b"),
    VideoProduct(48, "AB4", "바렐 전신 근막 FLOW", "54:22", "8MNTjnr-vTo", "ARCHIVE METHOD AB4 40D", "g2026062875aa3901a0e22"),
    VideoProduct(49, "AB8", "바렐 순환", "55:13", "Rro16e1EKcM", "ARCHIVE METHOD AB8 40D", "g20260628258a4b03dc237"),
]

LEGACY_PRODUCT_ALIASES: dict[int, str] = {
    3: "ACH7",
    4: "ACA4",
    5: "AB7",
    6: "AR3",
    7: "AB6",
    8: "ACH6",
    9: "AR2-1",
    10: "ACH5",
    11: "ACA2",
    12: "ACA3",
    13: "ACA1",
    14: "AB3",
    15: "ACH2",
    16: "AB2",
    17: "ACH1",
    18: "ACH4",
    19: "ACH3",
    20: "AB5",
    21: "AB1",
    22: "AR1",
    24: "AR4",
    25: "AB4",
    26: "AB8",
}


def run_imweb(args: list[str]) -> Any:
    cmd = [str(IMWEB), "--output", "json", *args]
    last_output = ""
    for attempt in range(5):
        result = subprocess.run(cmd, cwd=ROOT, text=True, capture_output=True, check=False)
        if result.returncode == 0:
            return json.loads(result.stdout)
        last_output = result.stderr or result.stdout
        retryable = (
            "rate_limited_retryable" in last_output
            or '"error_code": "30086"' in last_output
            or '"status_code": 429' in last_output
            or "너무 많은 요청" in last_output
        )
        if not retryable or attempt == 4:
            break
        time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"imweb command failed: {' '.join(args)}\n{last_output}")


def run_imweb_write(args: list[str], body: dict[str, Any]) -> Any:
    body_json = json.dumps(body, ensure_ascii=False, separators=(",", ":"))
    dry = run_imweb([*args, "--dry-run", "--data", body_json])
    token = dry.get("confirmation_token")
    if not token:
        raise RuntimeError(f"missing confirmation token for {' '.join(args)}")
    return run_imweb([*args, "--yes", "--confirm-token", token, "--data", body_json])


def load_state() -> dict[str, Any]:
    if not STATE_FILE.exists():
        return {"processed": {}}
    return json.loads(STATE_FILE.read_text(encoding="utf-8"))


def save_state(state: dict[str, Any]) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(STATE_FILE)


def load_youtube_ready_codes() -> set[str]:
    if not YOUTUBE_READY_FILE.exists():
        return set(DEFAULT_YOUTUBE_READY_CODES)
    payload = json.loads(YOUTUBE_READY_FILE.read_text(encoding="utf-8"))
    if isinstance(payload, list):
        return {str(code).strip().upper() for code in payload if str(code).strip()}
    if isinstance(payload, dict):
        codes = payload.get("readyCodes") or payload.get("codes") or []
        return {str(code).strip().upper() for code in codes if str(code).strip()}
    return set(DEFAULT_YOUTUBE_READY_CODES)


def append_jsonl(path: Path, payload: dict[str, Any]) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(payload, ensure_ascii=False, sort_keys=True) + "\n")


def append_delivery(delivery: dict[str, Any]) -> None:
    append_jsonl(DELIVERY_QUEUE_FILE, delivery)


def append_signup_notice(delivery: dict[str, Any]) -> None:
    append_jsonl(SIGNUP_QUEUE_FILE, delivery)


def is_paid(order: dict[str, Any]) -> bool:
    payments = order.get("payments") or []
    has_completed_payment = any(
        payment.get("paymentStatus") == "PAYMENT_COMPLETE"
        and payment.get("isCancel") != "Y"
        and float(payment.get("paidPrice") or 0) > 0
        for payment in payments
    )
    if has_completed_payment:
        return True
    return (
        float(order.get("totalPaymentPrice") or 0) > 0
        and float(order.get("totalRefundedPrice") or 0) == 0
        and order.get("isCancelReq") != "Y"
    )


def order_member_uid(order: dict[str, Any]) -> str | None:
    if order.get("isMember") != "Y":
        return None
    for key in ("memberUid", "uid"):
        value = order.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    member = order.get("member") or order.get("memberInfo") or {}
    value = member.get("uid") or member.get("memberUid")
    return value.strip() if isinstance(value, str) and value.strip() else None


def order_contact_email(order: dict[str, Any]) -> str | None:
    candidates = [
        order.get("ordererEmail"),
        order.get("email"),
        (order.get("orderer") or {}).get("email"),
        (order.get("ordererInfo") or {}).get("email"),
        (order.get("member") or {}).get("email"),
        (order.get("memberInfo") or {}).get("email"),
    ]
    for value in candidates:
        if isinstance(value, str) and "@" in value:
            return value.strip()
    return None


def order_items(order: dict[str, Any]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for section in order.get("sections") or []:
        for section_item in section.get("sectionItems") or []:
            product = section_item.get("productInfo") or {}
            prod_no = product.get("prodNo")
            if isinstance(prod_no, int):
                items.append(
                    {
                        "prodNo": prod_no,
                        "qty": section_item.get("qty") or 1,
                        "orderSectionItemNo": section_item.get("orderSectionItemNo"),
                    }
                )
    return items


def load_group_codes_by_member(video_products: list[VideoProduct]) -> dict[str, set[str]]:
    by_member: dict[str, set[str]] = {}
    for video in video_products:
        members = run_imweb(["member", "groups", "members", video.group_code, "--all", "--max-pages", "20"])
        time.sleep(0.15)
        for member in members if isinstance(members, list) else members.get("data", {}).get("list", []):
            uid = member.get("uid")
            if isinstance(uid, str) and uid:
                by_member.setdefault(uid, set()).add(video.group_code)
    return by_member


def normalize_rows(result: Any) -> list[dict[str, Any]]:
    if isinstance(result, list):
        return [row for row in result if isinstance(row, dict)]
    data = result.get("data") if isinstance(result, dict) else None
    if isinstance(data, list):
        return [row for row in data if isinstance(row, dict)]
    if isinstance(data, dict):
        rows = data.get("list") or data.get("data") or []
        return [row for row in rows if isinstance(row, dict)]
    rows = result.get("list", []) if isinstance(result, dict) else []
    return [row for row in rows if isinstance(row, dict)]


def find_member_uid_by_email(email: str, max_pages: int) -> str | None:
    needle = email.strip().lower()
    if not needle:
        return None

    candidates: list[dict[str, Any]] = []
    query_attempts = [
        ["member", "list", "--limit", "20", "--query", f"keyword={needle}"],
        ["member", "list-page", "--limit", "20", "--query", f"keyword={needle}"],
        ["member", "list", "--all", "--max-pages", str(max_pages)],
    ]
    for query in query_attempts:
        try:
            candidates.extend(normalize_rows(run_imweb(query)))
        except Exception:
            continue

    matches: dict[str, dict[str, Any]] = {}
    for member in candidates:
        uid = str(member.get("uid") or "").strip()
        member_email = str(member.get("email") or "").strip()
        if uid.lower() == needle or member_email.lower() == needle:
            matches[uid or member_email] = member

    if len(matches) != 1:
        return None
    uid = next(iter(matches.keys())).strip()
    return uid or None


def verify_groups(video_products: list[VideoProduct]) -> list[dict[str, Any]]:
    groups = run_imweb(["member", "groups", "list", "--all", "--max-pages", "10"])
    actual = {group.get("title"): group.get("siteGroupCode") for group in groups}
    rows = []
    for video in video_products:
        rows.append(
            {
                "code": video.code,
                "prodNo": video.prod_no,
                "groupTitle": video.group_title,
                "expected": video.group_code,
                "actual": actual.get(video.group_title),
                "ok": actual.get(video.group_title) == video.group_code,
            }
        )
    return rows


def build_delivery(order_no: str, member_uid: str, video: VideoProduct) -> dict[str, Any]:
    subject = f"[ARCHIVE PILATES] {video.code} 구매자 전용 시청 페이지"
    body = "\n".join(
        [
            "안녕하세요. ARCHIVE PILATES입니다.",
            "",
            "구매하신 온라인 클래스 시청 권한이 준비되었습니다.",
            f"- 클래스: ARCHIVE METHOD {video.title} ({video.code})",
            "- 시청 가능 기간: 권한 부여일 기준 40일",
            f"- 시청 페이지: {video.watch_url}",
            "",
            "결제한 아임웹 회원 계정으로 로그인한 뒤 위 페이지에서 시청해 주세요.",
            "무단 저장, 녹화, 복제, 공유, 재배포는 금지됩니다.",
            "",
            "시청 권한 확인이 필요하면 카카오톡 채널로 문의해 주세요.",
            "http://pf.kakao.com/_AHdvn/chat",
        ]
    )
    return {
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "orderNo": order_no,
        "memberUid": member_uid,
        "productNo": video.prod_no,
        "code": video.code,
        "to": member_uid,
        "subject": subject,
        "body": body,
        "watchUrl": video.watch_url,
    }


def build_signup_notice(order_no: str, to_email: str, video: VideoProduct) -> dict[str, Any]:
    subject = f"[ARCHIVE PILATES] {video.code} 온라인 클래스 회원가입 안내"
    body = "\n".join(
        [
            "안녕하세요. ARCHIVE PILATES입니다.",
            "",
            "구매하신 온라인 클래스는 구매자 전용 시청 페이지에서 제공됩니다.",
            "현재 주문은 비회원 주문으로 확인되어, 영상 권한을 바로 부여하려면 아임웹 회원 계정이 필요합니다.",
            "",
            f"- 클래스: ARCHIVE METHOD {video.title} ({video.code})",
            "- 시청 가능 기간: 권한 부여일 기준 40일",
            "- 회원가입/로그인: https://archivepilates.imweb.me/login",
            "",
            "주문에 사용한 이메일과 같은 이메일로 회원가입해 주세요.",
            "가입이 확인되면 해당 영상 전용 시청 권한을 부여하고 시청 페이지를 안내드리겠습니다.",
            "",
            "문의가 필요하면 카카오톡 채널로 연락해 주세요.",
            "http://pf.kakao.com/_AHdvn/chat",
        ]
    )
    return {
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "orderNo": order_no,
        "productNo": video.prod_no,
        "code": video.code,
        "to": to_email,
        "subject": subject,
        "body": body,
        "status": "needs_member_signup",
    }


def process_orders(args: argparse.Namespace) -> int:
    products_by_no = {video.prod_no: video for video in VIDEO_PRODUCTS}
    products_by_code = {video.code: video for video in VIDEO_PRODUCTS}
    for legacy_prod_no, code in LEGACY_PRODUCT_ALIASES.items():
        if code in products_by_code:
            products_by_no[legacy_prod_no] = products_by_code[code]
    state = load_state()
    state.setdefault("processed", {})
    youtube_ready_codes = load_youtube_ready_codes()
    member_groups = load_group_codes_by_member(VIDEO_PRODUCTS)

    listing = run_imweb(["order", "list", "--limit", str(args.limit)])
    rows = listing.get("data", {}).get("list", [])
    results: list[dict[str, Any]] = []

    for row in rows:
        order_no = str(row.get("orderNo") or "")
        if not order_no:
            continue
        detail = run_imweb(["order", "get", order_no]).get("data", {})
        time.sleep(0.15)
        if not is_paid(detail):
            results.append({"orderNo": order_no, "status": "skip_unpaid_or_closed"})
            continue
        member_uid = order_member_uid(detail)
        contact_email = order_contact_email(detail)
        resolved_guest = False
        if not member_uid and contact_email:
            member_uid = find_member_uid_by_email(contact_email, args.member_scan_max_pages)
            resolved_guest = bool(member_uid)
        for item in order_items(detail):
            video = products_by_no.get(item["prodNo"])
            if not video:
                continue
            key = f"{order_no}:{video.prod_no}:{member_uid or 'guest'}"
            if state["processed"].get(key, {}).get("status") == "granted":
                results.append({"orderNo": order_no, "code": video.code, "status": "already_granted"})
                continue
            current = member_groups.get(member_uid, set())
            if video.group_code in current:
                state["processed"][key] = {
                    "status": "already_has_access",
                    "productNo": video.prod_no,
                    "code": video.code,
                    "watchUrl": video.watch_url,
                    "resolvedGuestOrder": resolved_guest,
                    "updatedAt": datetime.now(timezone.utc).isoformat(),
                }
                results.append(
                    {
                        "orderNo": order_no,
                        "code": video.code,
                        "status": "already_has_access",
                        "resolvedGuestOrder": resolved_guest,
                    }
                )
                continue
            if not member_uid:
                already_pending = state["processed"].get(key, {}).get("status") == "needs_member_signup"
                state["processed"][key] = {
                    "status": "needs_member_signup",
                    "productNo": video.prod_no,
                    "code": video.code,
                    "updatedAt": datetime.now(timezone.utc).isoformat(),
                }
                if args.apply and contact_email and not already_pending:
                    append_signup_notice(build_signup_notice(order_no, contact_email, video))
                    status = "needs_member_signup_notice_queued"
                else:
                    status = "already_needs_member_signup" if already_pending else "needs_member_signup"
                results.append({"orderNo": order_no, "code": video.code, "status": status})
                continue
            if video.code.upper() not in youtube_ready_codes and not args.allow_youtube_unverified:
                state["processed"][key] = {
                    "status": "youtube_not_ready",
                    "productNo": video.prod_no,
                    "code": video.code,
                    "youtubeVideoId": video.youtube_video_id,
                    "updatedAt": datetime.now(timezone.utc).isoformat(),
                }
                results.append({"orderNo": order_no, "code": video.code, "status": "youtube_not_ready"})
                continue
            target_codes = sorted(current | {video.group_code})
            if args.apply:
                run_imweb_write(["member", "update", "groups", member_uid], {"groupCodes": target_codes})
                member_groups[member_uid] = set(target_codes)
                append_delivery(build_delivery(order_no, member_uid, video))
                status = "granted"
            else:
                status = "would_grant"
            state["processed"][key] = {
                "status": status,
                "productNo": video.prod_no,
                "code": video.code,
                "watchUrl": video.watch_url,
                "resolvedGuestOrder": resolved_guest,
                "updatedAt": datetime.now(timezone.utc).isoformat(),
            }
            results.append({"orderNo": order_no, "code": video.code, "status": status, "resolvedGuestOrder": resolved_guest})

    if args.apply:
        save_state(state)
    print(json.dumps({"apply": args.apply, "results": results}, ensure_ascii=False, indent=2))
    return 0


def build_watch_script() -> int:
    entries = []
    for video in VIDEO_PRODUCTS:
        entries.append(
            {
                "path": video.watch_path,
                "code": video.code,
                "title": video.title,
                "duration": video.duration,
                "videoToken": base64.urlsafe_b64encode(video.youtube_video_id.encode("ascii")).decode("ascii").rstrip("="),
                "productUrl": video.product_url,
                "groupTitle": video.group_title,
            }
        )
    script = f"""<script data-archive-pilates-buyer-watch=\"2026-06-28\">
(function(){{
  var VIDEOS = {json.dumps(entries, ensure_ascii=False, separators=(",", ":"))};
  var KAKAO_URL = "http://pf.kakao.com/_AHdvn/chat";
  function pathKey(){{
    return (location.pathname || "").replace(/\\/$/, "");
  }}
  function currentVideo(){{
    var path = pathKey();
    for (var i = 0; i < VIDEOS.length; i++) {{
      if (VIDEOS[i].path === path) return VIDEOS[i];
    }}
    return null;
  }}
  function ensureStyle(){{
    if(document.getElementById("ap-buyer-watch-style")) return;
    var style = document.createElement("style");
    style.id = "ap-buyer-watch-style";
    style.textContent = "html[data-ap-buyer-watch='true'] body{{background:#fffdfa;color:#181614;}}html[data-ap-buyer-watch='true'] #doz_content{{min-height:0}}.ap-watch{{font-family:inherit;background:#fffdfa;color:#181614;padding:122px 20px 84px}}.ap-watch *{{box-sizing:border-box}}.ap-watch__inner{{max-width:1120px;margin:0 auto}}.ap-watch__eyebrow{{margin:0 0 14px;font-size:12px;letter-spacing:.12em;font-weight:800;color:#8c3425}}.ap-watch__grid{{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:28px;align-items:start}}.ap-watch h1{{margin:0 0 12px;font-size:34px;line-height:1.18;letter-spacing:0;color:#171412}}.ap-watch__meta{{margin:0 0 24px;color:#6d625b;font-size:15px;line-height:1.6}}.ap-watch__notice{{border:1px solid #e5ddd4;background:#fbf7f1;padding:16px 18px;margin:0 0 22px;color:#37312c;line-height:1.7}}.ap-watch__video{{position:relative;aspect-ratio:16/9;background:#111;border:1px solid #e5ddd4;overflow:hidden}}.ap-watch__video iframe{{position:absolute;inset:0;width:100%;height:100%;border:0}}.ap-watch__panel{{border:1px solid #e5ddd4;background:#fff;padding:22px}}.ap-watch__panel h2{{font-size:18px;line-height:1.3;margin:0 0 14px;color:#171412}}.ap-watch__panel ul{{margin:0;padding-left:18px;color:#4d4640;line-height:1.8}}.ap-watch__actions{{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}}.ap-watch__btn{{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:12px 16px;border:1px solid #1e1b18;text-decoration:none!important;color:#fff!important;background:#1e1b18;font-weight:800}}.ap-watch__btn--sub{{background:#fff!important;color:#1e1b18!important;border-color:#d8cec3}}.ap-watch__foot{{margin:22px 0 0;color:#7c7169;font-size:13px;line-height:1.6}}@media(max-width:860px){{.ap-watch{{padding:96px 16px 64px}}.ap-watch__grid{{grid-template-columns:1fr}}.ap-watch h1{{font-size:28px}}.ap-watch__panel{{padding:18px}}}}";
    document.head.appendChild(style);
  }}
  function esc(s){{
    return String(s || "").replace(/[&<>"']/g, function(c){{return ({{"&":"&amp;","<":"&lt;",">":"&gt;","\\\"":"&quot;","'":"&#39;"}})[c];}});
  }}
  function decodeVideo(token){{
    var s = String(token || "");
    while(s.length % 4) s += "=";
    return atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  }}
  function render(){{
    var video = currentVideo();
    if(!video || document.querySelector(".ap-watch")) return;
    document.documentElement.setAttribute("data-ap-buyer-watch", "true");
    ensureStyle();
    var videoId = decodeVideo(video.videoToken);
    var section = document.createElement("section");
    section.className = "ap-watch";
    section.innerHTML = '<div class="ap-watch__inner"><p class="ap-watch__eyebrow">ARCHIVE PILATES · BUYER ACCESS</p><div class="ap-watch__grid"><main><h1>ARCHIVE METHOD '+esc(video.title)+'</h1><p class="ap-watch__meta">'+esc(video.code)+' · 민진쌤 · 풀영상 '+esc(video.duration)+' · 구매 후 40일 시청</p><div class="ap-watch__notice">이 페이지는 온라인 클래스 구매 후 부여된 회원그룹 권한으로 접근하는 구매자 전용 시청 화면입니다. 풀영상 URL을 별도로 발송하지 않고, 로그인한 구매자가 이 페이지에서 임베드 영상으로 시청합니다.</div><div class="ap-watch__video"><iframe src="https://www.youtube.com/embed/'+encodeURIComponent(videoId)+'?rel=0&modestbranding=1" title="ARCHIVE METHOD '+esc(video.code)+' buyer video" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div><p class="ap-watch__foot">무단 저장, 녹화, 복제, 공유, 재배포는 금지됩니다. 시청 권한 또는 결제 확인이 필요하면 카카오톡 문의로 연락해 주세요.</p></main><aside class="ap-watch__panel"><h2>시청 안내</h2><ul><li>결제 계정으로 로그인 후 접근합니다.</li><li>권한 그룹: '+esc(video.groupTitle)+'</li><li>시청 가능 기간: 권한 부여일 기준 40일</li><li>구매내역/상품 상세에서 다시 찾을 수 있도록 운영합니다.</li></ul><div class="ap-watch__actions"><a class="ap-watch__btn" href="'+esc(video.productUrl)+'">상품 상세</a><a class="ap-watch__btn ap-watch__btn--sub" href="'+KAKAO_URL+'">카카오톡 문의</a></div></aside></div></div>';
    var content = document.getElementById("doz_content") || document.querySelector("main") || document.body;
    if(content && content !== document.body){{
      content.innerHTML = "";
      content.appendChild(section);
    }} else {{
      document.body.insertBefore(section, document.body.firstChild);
    }}
  }}
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", render); else render();
  setTimeout(render, 300);
  setTimeout(render, 1200);
}})();
</script>"""
    print(script)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("verify-groups")
    sub.add_parser("build-watch-script")

    scan = sub.add_parser("process-orders")
    scan.add_argument("--limit", type=int, default=20)
    scan.add_argument("--member-scan-max-pages", type=int, default=50)
    scan.add_argument("--allow-youtube-unverified", action="store_true")
    scan.add_argument("--apply", action="store_true")

    args = parser.parse_args()
    if args.command == "verify-groups":
        rows = verify_groups(VIDEO_PRODUCTS)
        print(json.dumps(rows, ensure_ascii=False, indent=2))
        return 0 if all(row["ok"] for row in rows) else 1
    if args.command == "build-watch-script":
        return build_watch_script()
    if args.command == "process-orders":
        return process_orders(args)
    raise AssertionError(args.command)


if __name__ == "__main__":
    sys.exit(main())
