#!/usr/bin/env python3
"""Build no-PII D7/D30 ARCHIVE PILATES video follow-up candidates.

The script never sends a member-facing message. It reads canonical Imweb paid
orders, applies consent and cancellation guards, and writes a deterministic
operator-review report only when --write is supplied.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import time
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parents[1]
IMWEB = Path("/Users/archivepilates/.local/bin/imweb")
OUTPUT_DIR = ROOT / "artifacts" / "imweb-video-followup-candidates"
KST = ZoneInfo("Asia/Seoul")


@dataclass(frozen=True)
class VideoProduct:
    prod_no: int
    code: str
    title: str

    @property
    def detail_url(self) -> str:
        return f"https://archivepilates.imweb.me/17/?idx={self.prod_no}"

    @property
    def review_url(self) -> str:
        return f"{self.detail_url}#prod_detail_review"


PRODUCTS = [
    VideoProduct(27, "AR1", "리포머 척추 정렬 & 코어 컨트롤"),
    VideoProduct(28, "ACH7", "체어 흉추가동성"),
    VideoProduct(29, "ACA4", "캐딜락 흉추가동성"),
    VideoProduct(30, "AB7", "바렐 요추안정화"),
    VideoProduct(31, "AR3", "리포머 요추안정화"),
    VideoProduct(32, "AB6", "바렐 직장인 증후군"),
    VideoProduct(33, "ACH6", "체어 직장인 증후군"),
    VideoProduct(34, "AR2-1", "리포머 챌린지 동작 빌드업"),
    VideoProduct(35, "ACH5", "체어 고강도 필라테스"),
    VideoProduct(36, "ACA2", "캐딜락 경추보호 코어강화"),
    VideoProduct(37, "ACA3", "캐딜락 고강도 필라테스"),
    VideoProduct(38, "ACA1", "캐딜락 보상패턴 바로잡기"),
    VideoProduct(39, "AB3", "바렐 척추 유연성 & 어깨 안정화"),
    VideoProduct(40, "ACH2", "체어 림프 순환 & 척추 컨트롤"),
    VideoProduct(41, "AB2", "바렐 척추 신장 & 복부 컨트롤"),
    VideoProduct(42, "ACH1", "체어 골반 & 체간 안정화"),
    VideoProduct(43, "ACH4", "체어 골반 안정화 & 비대칭 교정"),
    VideoProduct(44, "ACH3", "체어 정렬 인지 & 체간 안정화"),
    VideoProduct(45, "AB5", "바렐 크로스패턴"),
    VideoProduct(46, "AB1", "바렐 척추 신장 & 흉곽 안정화"),
    VideoProduct(47, "AR4", "리포머 순환"),
    VideoProduct(48, "AB4", "바렐 전신 근막 FLOW"),
    VideoProduct(49, "AB8", "바렐 순환"),
    VideoProduct(50, "ACH8", "체어 호흡"),
    VideoProduct(51, "ACA5", "캐딜락 호흡"),
    VideoProduct(79, "AB9", "바렐 골반·고관절"),
    VideoProduct(80, "AR5", "리포머 골반·고관절"),
]
BY_NO = {product.prod_no: product for product in PRODUCTS}
BY_CODE = {product.code: product for product in PRODUCTS}
NEXT_CODE = {"ACH8": "ACA5", "AB9": "AR5", "AB8": "AR4", "AR1": "ACH3"}


def run_imweb(args: list[str]) -> Any:
    command = [str(IMWEB), "--output", "json", *args]
    last_output = ""
    for attempt in range(5):
        result = subprocess.run(
            command,
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
        )
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
    raise RuntimeError(f"Imweb command failed: {' '.join(args)}\n{last_output}")


def rows_from(result: Any) -> list[dict[str, Any]]:
    if not isinstance(result, dict):
        return []
    data = result.get("data")
    if isinstance(data, dict):
        rows = data.get("list") or []
        return [row for row in rows if isinstance(row, dict)]
    if isinstance(data, list):
        return [row for row in data if isinstance(row, dict)]
    return []


def list_orders_paginated(max_pages: int, page_size: int) -> list[dict[str, Any]]:
    orders: list[dict[str, Any]] = []
    for page in range(1, max_pages + 1):
        result = run_imweb(
            [
                "order",
                "list",
                "--page",
                str(page),
                "--limit",
                str(page_size),
            ]
        )
        page_rows = rows_from(result)
        orders.extend(page_rows)
        data = result.get("data") if isinstance(result, dict) else None
        total_pages = data.get("totalPage") if isinstance(data, dict) else None
        if not page_rows or (isinstance(total_pages, int) and page >= total_pages):
            break
        time.sleep(0.15)
    return orders


def paid_order(order: dict[str, Any]) -> bool:
    payments = order.get("payments") or []
    completed = any(
        payment.get("paymentStatus") == "PAYMENT_COMPLETE"
        and payment.get("isCancel") != "Y"
        and float(payment.get("paidPrice") or 0) > 0
        for payment in payments
    )
    return (
        completed
        and float(order.get("totalPaymentPrice") or 0) > 0
        and float(order.get("totalRefundedPrice") or 0) == 0
        and float(order.get("totalRefundPendingPrice") or 0) == 0
    )


def payment_date(order: dict[str, Any]) -> date | None:
    candidates = [
        payment.get("paymentCompleteTime")
        for payment in order.get("payments") or []
        if payment.get("paymentStatus") == "PAYMENT_COMPLETE"
        and payment.get("isCancel") != "Y"
    ]
    for value in candidates:
        if not isinstance(value, str) or not value:
            continue
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(KST).date()
    return None


def member_uid(order: dict[str, Any]) -> str | None:
    if order.get("isMember") != "Y":
        return None
    value = order.get("memberUid")
    return value.strip() if isinstance(value, str) and value.strip() else None


def video_items(order: dict[str, Any]) -> list[VideoProduct]:
    products: list[VideoProduct] = []
    for section in order.get("sections") or []:
        for item in section.get("sectionItems") or []:
            product_info = item.get("productInfo") or {}
            prod_no = product_info.get("prodNo")
            if isinstance(prod_no, int) and prod_no in BY_NO:
                products.append(BY_NO[prod_no])
    return products


def opaque(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:20]


def consent_enabled(value: Any) -> bool:
    if value is True:
        return True
    if value is False or value is None:
        return False
    return str(value).strip().upper() in {"Y", "YES", "TRUE", "1"}


def exact_member_consent(uid: str, cache: dict[str, bool | None]) -> bool | None:
    if uid in cache:
        return cache[uid]
    result = run_imweb(["member", "list", "--limit", "20", "--query", f"keyword={uid}"])
    matches = [
        row
        for row in rows_from(result)
        if str(row.get("uid") or "").strip().lower() == uid.lower()
    ]
    cache[uid] = consent_enabled(matches[0].get("smsAgree")) if len(matches) == 1 else None
    return cache[uid]


def candidate_id(order_no: str, member: str, stage: str, codes: list[str]) -> str:
    source = ":".join(["imweb", order_no, member, stage, ",".join(sorted(codes))])
    return opaque(source)


def build_candidates(
    orders: list[dict[str, Any]],
    as_of: date,
    consent_by_uid: dict[str, bool | None],
    lookup_missing_consent: bool,
) -> dict[str, Any]:
    purchased_by_member: dict[str, set[str]] = defaultdict(set)
    for order in orders:
        if not paid_order(order):
            continue
        uid = member_uid(order)
        if not uid:
            continue
        purchased_by_member[uid].update(product.code for product in video_items(order))

    counters: Counter[str] = Counter()
    candidates: list[dict[str, Any]] = []
    due_rules = {"review_d7": 7, "recommend_d30": 30}

    for order in orders:
        products = video_items(order)
        if not products:
            continue
        if not paid_order(order):
            counters["excluded_unpaid_cancelled_or_refunded"] += 1
            continue
        paid_on = payment_date(order)
        if paid_on is None:
            counters["excluded_missing_payment_time"] += 1
            continue
        uid = member_uid(order)
        if not uid:
            counters["excluded_non_member"] += 1
            continue

        for stage, offset in due_rules.items():
            if paid_on + timedelta(days=offset) != as_of:
                continue
            counters[f"due_{stage}"] += 1
            consent = consent_by_uid.get(uid)
            if consent is None and lookup_missing_consent:
                consent = exact_member_consent(uid, consent_by_uid)
            if consent is not True:
                counters[f"held_{stage}_consent"] += 1
                continue

            source_codes = sorted({product.code for product in products})
            order_no = str(order.get("orderNo") or "")
            base = {
                "candidateId": candidate_id(order_no, uid, stage, source_codes),
                "stage": stage,
                "dueDate": as_of.isoformat(),
                "orderKey": opaque(order_no),
                "memberKey": opaque(uid),
                "sourceCodes": source_codes,
                "sendEligible": False,
                "holdReason": "approved_message_template_and_operator_test_required",
            }

            if stage == "review_d7":
                review_links = [product.review_url for product in products]
                base.update(
                    {
                        "reviewLinks": review_links,
                        "messageDraft": (
                            "ARCHIVE PILATES 온라인 클래스를 수업에 적용해 보셨나요? "
                            "도움이 된 점과 더 궁금한 점을 구매평으로 남겨 주세요. "
                            + " ".join(review_links)
                        ),
                    }
                )
                candidates.append(base)
                counters["candidate_review_d7"] += 1
                continue

            recommendations: list[VideoProduct] = []
            owned = purchased_by_member.get(uid, set())
            for source_code in source_codes:
                target_code = NEXT_CODE.get(source_code)
                if target_code and target_code not in owned:
                    recommendations.append(BY_CODE[target_code])
            recommendations = list({product.code: product for product in recommendations}.values())
            if not recommendations:
                counters["held_recommend_d30_no_new_target"] += 1
                continue
            base.update(
                {
                    "recommendedCodes": [product.code for product in recommendations],
                    "recommendationLinks": [product.detail_url for product in recommendations],
                    "messageDraft": (
                        "시청 기간이 10일 남았습니다. 구매한 수업을 한 번 더 복습하고, "
                        "같은 주제를 다른 기구로 이어 보세요. "
                        + " ".join(product.detail_url for product in recommendations)
                    ),
                }
            )
            candidates.append(base)
            counters["candidate_recommend_d30"] += 1

    return {
        "asOf": as_of.isoformat(),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": "Imweb paid order list",
        "containsPII": False,
        "readyForMemberSend": False,
        "summary": dict(sorted(counters.items())),
        "candidates": candidates,
    }


def self_test() -> None:
    assert consent_enabled(True) is True
    assert consent_enabled("Y") is True
    assert consent_enabled("N") is False
    assert consent_enabled(False) is False

    paid_at = "2026-07-22T02:00:00.000Z"
    order = {
        "orderNo": "test-order",
        "isMember": "Y",
        "memberUid": "member@example.test",
        "totalPaymentPrice": 15000,
        "totalRefundedPrice": 0,
        "totalRefundPendingPrice": 0,
        "payments": [
            {
                "paymentStatus": "PAYMENT_COMPLETE",
                "isCancel": "N",
                "paidPrice": 15000,
                "paymentCompleteTime": paid_at,
            }
        ],
        "sections": [{"sectionItems": [{"productInfo": {"prodNo": 50}}]}],
    }
    d7 = build_candidates(
        [order],
        date(2026, 7, 29),
        {"member@example.test": True},
        False,
    )
    assert len(d7["candidates"]) == 1
    assert d7["candidates"][0]["stage"] == "review_d7"
    assert d7["candidates"][0]["sendEligible"] is False

    d30_order = json.loads(json.dumps(order))
    d30_order["payments"][0]["paymentCompleteTime"] = "2026-06-29T02:00:00.000Z"
    d30 = build_candidates(
        [d30_order],
        date(2026, 7, 29),
        {"member@example.test": True},
        False,
    )
    assert d30["candidates"][0]["recommendedCodes"] == ["ACA5"]

    already_owned = json.loads(json.dumps(d30_order))
    already_owned["orderNo"] = "test-order-2"
    already_owned["sections"][0]["sectionItems"][0]["productInfo"]["prodNo"] = 51
    already_owned["payments"][0]["paymentCompleteTime"] = "2026-07-28T02:00:00.000Z"
    blocked = build_candidates(
        [d30_order, already_owned],
        date(2026, 7, 29),
        {"member@example.test": True},
        False,
    )
    assert blocked["candidates"] == []
    assert blocked["summary"]["held_recommend_d30_no_new_target"] == 1

    no_consent = build_candidates(
        [order],
        date(2026, 7, 29),
        {"member@example.test": False},
        False,
    )
    assert no_consent["candidates"] == []
    assert no_consent["summary"]["held_review_d7_consent"] == 1

    cancelled = json.loads(json.dumps(order))
    cancelled["payments"][0]["isCancel"] = "Y"
    assert (
        build_candidates(
            [cancelled],
            date(2026, 7, 29),
            {"member@example.test": True},
            False,
        )["candidates"]
        == []
    )

    refunded = json.loads(json.dumps(order))
    refunded["totalRefundedPrice"] = 15000
    assert (
        build_candidates(
            [refunded],
            date(2026, 7, 29),
            {"member@example.test": True},
            False,
        )["candidates"]
        == []
    )

    non_member = json.loads(json.dumps(order))
    non_member["isMember"] = "N"
    assert (
        build_candidates(
            [non_member],
            date(2026, 7, 29),
            {},
            False,
        )["candidates"]
        == []
    )
    print("Validated Imweb video follow-up candidate rules.")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--as-of", default=datetime.now(KST).date().isoformat())
    parser.add_argument("--max-pages", type=int, default=10)
    parser.add_argument("--page-size", type=int, default=5)
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        self_test()
        return 0

    as_of = date.fromisoformat(args.as_of)
    orders = list_orders_paginated(args.max_pages, args.page_size)
    report = build_candidates(orders, as_of, {}, True)
    report["scannedOrders"] = len(orders)

    if args.write:
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        output_path = OUTPUT_DIR / f"candidates-{as_of.isoformat()}.json"
        temporary = output_path.with_suffix(".tmp")
        temporary.write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        temporary.replace(output_path)
        report["outputPath"] = str(output_path)

    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
