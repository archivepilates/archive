#!/usr/bin/env python3
"""Update Imweb product details for TossPay merchant re-review.

The script is intentionally product-content only. It does not touch orders,
members, entitlements, prices, stock, payment settings, or delivery templates.
Every remote write is preceded by an Imweb CLI dry-run and a local backup.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any


ONLINE_CATEGORY = "s20260613848c8356b9c73"
OFFLINE_CATEGORY = "s20260613a41f3d6464dfe"
KNITIDO_CATEGORY = "s2026051668d24d49ef360"
POLICY_VERSION = "2026-07-30"
UNIT_CODE = "u2026051698c99ea234719"


ONLINE_POLICY = """
<!-- ARCHIVE_TOSSPAY_POLICY_START -->
<div data-archive-pilates-tosspay="online-2026-07-30" style="padding:22px;border:2px solid #1e1b18;background:#fffdfa;margin:24px 0;color:#1f1f1f;line-height:1.75;">
  <h3 style="font-size:20px;margin:0 0 12px;color:#171717;">결제 후 제공 방식 · 이용기간 · 환불 기준</h3>
  <ul style="padding-left:20px;margin:0;color:#333;">
    <li><strong>제공 방식:</strong> 결제 완료 즉시 구매 계정에 해당 영상의 회원그룹 시청 권한이 자동 부여됩니다. 로그인 후 <strong>내 강의실</strong>에서 스트리밍으로 시청합니다.</li>
    <li><strong>제공 시작:</strong> 결제 완료와 시청 권한 부여 시점부터 이용할 수 있습니다. 권한 반영이 지연되면 카카오톡 문의로 확인해 주세요.</li>
    <li><strong>최종 제공 완료:</strong> 시청 권한 부여일로부터 40일이 되는 날에 이용기간이 종료됩니다.</li>
    <li><strong>이용 범위:</strong> 구매한 영상 1편을 40일 동안 반복 스트리밍할 수 있으며 파일 다운로드는 제공하지 않습니다.</li>
    <li><strong>전액 환불:</strong> 결제일로부터 7일 이내이면서 영상 재생 이력이 없는 경우 전액 환불합니다.</li>
    <li><strong>재생 시작 후 환불:</strong> 시청을 시작했거나 결제 후 7일이 지난 경우, 40일 이용기간의 1/3 경과 전에는 결제금액의 2/3, 1/3 이후부터 1/2 경과 전에는 1/2을 환불하며, 1/2 경과 후에는 환불되지 않습니다.</li>
    <li><strong>산정 기준:</strong> 시청 권한 부여 시각부터 환불 요청 접수 시각까지의 경과기간과 재생 이력을 기준으로 하며, 관계 법령 또는 소비자분쟁해결기준이 더 유리하게 적용되는 경우 해당 기준을 따릅니다.</li>
    <li><strong>예외 처리:</strong> 중복 결제, 권한 미부여 또는 사업자 귀책의 재생 장애로 정상 이용이 불가능한 경우 확인 후 전액 환불하거나 이용기간을 연장합니다.</li>
  </ul>
</div>
<!-- ARCHIVE_TOSSPAY_POLICY_END -->
""".strip()


OFFLINE_POLICY = """
<!-- ARCHIVE_TOSSPAY_POLICY_START -->
<div data-archive-pilates-tosspay="offline-2026-07-30" style="padding:22px;border:2px solid #1e1b18;background:#fffdfa;margin:24px 0;color:#1f1f1f;line-height:1.75;">
  <h3 style="font-size:20px;margin:0 0 12px;color:#171717;">결제 후 제공 방식 · 사용기한 · 폐강/환불 기준</h3>
  <ul style="padding-left:20px;margin:0;color:#333;">
    <li><strong>제공 방식:</strong> 결제 완료 즉시 2026년 8월 29일 토요일 13:00~15:10 오프라인 강사레슨 예약권으로 접수되며, 주문자 연락처로 참여 팀을 확정 안내합니다.</li>
    <li><strong>서비스 제공일:</strong> 2026년 8월 29일 토요일 13:00~15:10, 부산 명지 ARCHIVE PILATES에서 1회 제공됩니다.</li>
    <li><strong>최종 제공 완료:</strong> 해당 수업 종료 시점인 2026년 8월 29일 15:10에 서비스 제공이 완료되고 수강권 사용기한이 종료됩니다.</li>
    <li><strong>모집 미달:</strong> 결제 완료로 예약이 확정된 회차는 모집 인원과 관계없이 진행하며, 모집 미달을 이유로 폐강하지 않습니다.</li>
    <li><strong>수업 시작 전 취소:</strong> 2026년 8월 29일 13:00 전까지 취소를 요청하면 결제금액 전액을 환불합니다.</li>
    <li><strong>수업 시작 후 환불:</strong> 총 수업시간의 1/3 경과 전에는 결제금액의 2/3, 1/3 이후부터 1/2 경과 전에는 1/2을 환불하며, 1/2 경과 후에는 환불되지 않습니다.</li>
    <li><strong>무단 불참:</strong> 수업에 참석하지 않고 수업 시작 후 환불을 요청한 경우에도 위 진행시간 기준을 적용합니다.</li>
    <li><strong>운영자 취소·일정 변경:</strong> 강사 또는 스튜디오 사정으로 수업이 취소되면 전액 환불합니다. 일정이 변경되면 변경 회차 수강 또는 전액 환불 중 선택할 수 있습니다.</li>
  </ul>
</div>
<!-- ARCHIVE_TOSSPAY_POLICY_END -->
""".strip()


PHYSICAL_POLICY = """
<!-- ARCHIVE_TOSSPAY_POLICY_START -->
<section data-archive-pilates-tosspay="physical-2026-07-30" style="padding:24px;border:2px solid #1e1b18;background:#fffdfa;margin:28px 0;">
  <h3 style="margin:0 0 10px;color:#171717;font-size:19px;line-height:1.4;">배송 및 교환·반품</h3>
  <div class="ap-knitido-shipping-detail" data-archive-pilates-knitido-shipping-detail="2026-07-29c" role="note">
    <dl class="ap-knitido-shipping-facts">
      <div class="ap-knitido-shipping-fact"><dt>평균 배송일</dt><dd>결제 완료 후 영업일 기준 2~3일</dd></div>
      <div class="ap-knitido-shipping-fact"><dt>출고 일정</dt><dd>재고 확인 후 영업일 기준 1~2일 이내</dd></div>
      <div class="ap-knitido-shipping-fact"><dt>최대 배송 완료일</dt><dd>결제일로부터 14일 이내</dd></div>
    </dl>
    <p>주말·공휴일 주문, 도서산간 지역 및 택배사 사정에 따라 배송이 지연될 수 있습니다. 지연이 예상되면 사전에 안내하며, 결제일로부터 14일 이내 배송이 어려운 경우 취소·환불을 지원합니다.</p>
  </div>
  <ul style="padding-left:20px;margin:0;color:#333;">
    <li style="margin:5px 0;">기본 배송비는 3,000원이며, 구매 금액과 관계없이 동일하게 적용됩니다.</li>
    <li style="margin:5px 0;">단순 변심 교환·반품은 수령 후 7일 이내, 미착용 상태에서 가능합니다. 왕복 배송비는 구매자 부담입니다.</li>
    <li style="margin:5px 0;">상품 불량 또는 오배송은 아카이브가 배송비를 부담합니다.</li>
    <li style="margin:5px 0;">착용·세탁·오염·향 배임 또는 포장과 택 훼손으로 상품 가치가 감소한 경우 교환·반품이 제한될 수 있습니다.</li>
  </ul>
</section>
<!-- ARCHIVE_TOSSPAY_POLICY_END -->
""".strip()


MARKED_POLICY_RE = re.compile(
    r"\s*<!-- ARCHIVE_TOSSPAY_POLICY_START -->.*?"
    r"<!-- ARCHIVE_TOSSPAY_POLICY_END -->\s*",
    re.DOTALL,
)


def run_json(command: list[str], retries: int = 6) -> Any:
    for attempt in range(retries + 1):
        completed = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
        )
        if completed.returncode == 0:
            try:
                return json.loads(completed.stdout)
            except json.JSONDecodeError as exc:
                raise RuntimeError(f"Non-JSON output from {' '.join(command)}") from exc

        detail = completed.stderr.strip() or completed.stdout.strip()
        is_rate_limit = (
            '"status_code": 429' in detail
            or '"error_code": "30086"' in detail
            or "너무 많은 요청" in detail
        )
        if is_rate_limit and attempt < retries:
            time.sleep(min(2 ** attempt, 16))
            continue
        raise RuntimeError(
            f"Command failed ({completed.returncode}): {' '.join(command)}\n{detail}"
        )
    raise RuntimeError(f"Retry loop exhausted: {' '.join(command)}")


def replace_div_with_attribute(content: str, attribute: str, replacement: str) -> str:
    marker = content.find(attribute)
    if marker < 0:
        return insert_before_outer_close(content, replacement)
    start = content.rfind("<div", 0, marker)
    end = content.find("</div>", marker)
    if start < 0 or end < 0:
        return insert_before_outer_close(content, replacement)
    return content[:start] + replacement + content[end + len("</div>") :]


def replace_shipping_section(content: str, replacement: str) -> str:
    heading_positions = [
        content.find("배송 및 교환&middot;반품"),
        content.find("배송 및 교환·반품"),
    ]
    heading = max(heading_positions)
    if heading < 0:
        return insert_before_outer_close(content, replacement)
    start = content.rfind("<section", 0, heading)
    end = content.find("</section>", heading)
    if start < 0 or end < 0:
        return insert_before_outer_close(content, replacement)
    return content[:start] + replacement + content[end + len("</section>") :]


def insert_before_outer_close(content: str, block: str) -> str:
    end = content.rfind("</section>")
    if end < 0:
        return content.rstrip() + "\n" + block
    return content[:end] + "\n" + block + "\n" + content[end:]


def update_content(product: dict[str, Any]) -> tuple[str | None, str]:
    content = str(product.get("content") or "")
    categories = set(product.get("categories") or [])
    if product.get("prodStatus") != "sale" or product.get("isDisplay") != "Y":
        return None, "excluded_not_live_sale"
    if ONLINE_CATEGORY in categories and product.get("prodType") == "subscribe":
        if f'data-archive-pilates-tosspay="online-{POLICY_VERSION}"' in content:
            return content, "online"
        cleaned = MARKED_POLICY_RE.sub("\n", content)
        return (
            replace_div_with_attribute(
                cleaned,
                "data-archive-pilates-pg-review",
                ONLINE_POLICY,
            ),
            "online",
        )
    if OFFLINE_CATEGORY in categories and int(product.get("prodNo") or 0) == 1:
        if f'data-archive-pilates-tosspay="offline-{POLICY_VERSION}"' in content:
            return content, "offline"
        cleaned = MARKED_POLICY_RE.sub("\n", content)
        return (
            replace_div_with_attribute(
                cleaned,
                "data-archive-pilates-pg-review",
                OFFLINE_POLICY,
            ),
            "offline",
        )
    if KNITIDO_CATEGORY in categories:
        if f'data-archive-pilates-tosspay="physical-{POLICY_VERSION}"' in content:
            return content, "physical"
        cleaned = MARKED_POLICY_RE.sub("\n", content)
        return replace_shipping_section(cleaned, PHYSICAL_POLICY), "physical"
    return None, "excluded_other"


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Execute product content writes after per-product dry-runs.",
    )
    parser.add_argument(
        "--product-no",
        type=int,
        action="append",
        default=[],
        help="Limit to one or more product numbers.",
    )
    parser.add_argument(
        "--kind",
        choices=["online", "offline", "physical"],
        action="append",
        default=[],
        help="Limit changes to one or more product policy kinds.",
    )
    parser.add_argument(
        "--artifact-dir",
        default=f"artifacts/{dt.date.today().isoformat()}-imweb-tosspay-policy",
    )
    parser.add_argument("--sleep-ms", type=int, default=500)
    args = parser.parse_args()

    artifact_dir = Path(args.artifact_dir).resolve()
    inventory: list[dict[str, Any]] = []
    for page in range(1, 11):
        page_rows = run_json(
            [
                "imweb",
                "--output",
                "json",
                "product",
                "list",
                "--page",
                str(page),
                "--limit",
                "20",
            ]
        )
        if isinstance(page_rows, dict):
            page_rows = ((page_rows.get("data") or {}).get("list") or [])
        if not isinstance(page_rows, list):
            raise RuntimeError("Unexpected product list response.")
        inventory.extend(page_rows)
        if len(page_rows) < 20:
            break

    selected = set(args.product_no)
    products = [
        row
        for row in inventory
        if not selected or int(row.get("prodNo") or 0) in selected
    ]
    summary: dict[str, int] = {}
    changes: list[dict[str, Any]] = []

    for row in sorted(products, key=lambda item: int(item.get("prodNo") or 0)):
        prod_no = int(row.get("prodNo") or 0)
        detail_response = run_json(
            ["imweb", "--output", "json", "product", "get", str(prod_no)]
        )
        time.sleep(max(args.sleep_ms, 0) / 1000)
        product = detail_response.get("data") or {}
        updated_content, kind = update_content(product)
        summary[kind] = summary.get(kind, 0) + 1
        if args.kind and kind not in set(args.kind):
            continue
        if updated_content is None or updated_content == (product.get("content") or ""):
            continue

        product_dir = artifact_dir / "products" / str(prod_no)
        write_json(product_dir / "before.json", detail_response)
        payload = {
            # The read response exposes `content`, while the official PATCH
            # schema names the writable product-detail field `description`.
            "description": updated_content,
            "unitCode": UNIT_CODE,
        }
        write_json(product_dir / "payload.json", payload)

        dry_run = run_json(
            [
                "imweb",
                "--output",
                "json",
                "product",
                "update",
                "info",
                str(prod_no),
                "--data",
                f"@{product_dir / 'payload.json'}",
                "--dry-run",
            ]
        )
        time.sleep(max(args.sleep_ms, 0) / 1000)
        write_json(product_dir / "dry-run.json", dry_run)
        change = {
            "prodNo": prod_no,
            "name": product.get("name"),
            "kind": kind,
            "applied": False,
        }

        if args.apply:
            command = [
                "imweb",
                "--output",
                "json",
                "product",
                "update",
                "info",
                str(prod_no),
                "--data",
                f"@{product_dir / 'payload.json'}",
                "--yes",
                "--confirm-token",
                dry_run["confirmation_token"],
            ]
            bulk_token = dry_run.get("bulk_confirmation_token")
            if bulk_token:
                command.extend(["--bulk-confirm-token", bulk_token])
            applied = run_json(command)
            write_json(product_dir / "apply.json", applied)

            readback = run_json(
                ["imweb", "--output", "json", "product", "get", str(prod_no)]
            )
            write_json(product_dir / "readback.json", readback)
            live_content = str((readback.get("data") or {}).get("content") or "")
            expected_marker = f'data-archive-pilates-tosspay="{kind}-{POLICY_VERSION}"'
            if expected_marker not in live_content:
                raise RuntimeError(f"Readback marker missing for product {prod_no}.")
            change["applied"] = True

        changes.append(change)
        time.sleep(max(args.sleep_ms, 0) / 1000)

    result = {
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "mode": "apply" if args.apply else "dry-run",
        "siteCode": "S20260516852c71a014d08",
        "unitCode": UNIT_CODE,
        "summary": summary,
        "changeCount": len(changes),
        "changes": changes,
        "untouchedDomains": [
            "orders",
            "members",
            "entitlements",
            "prices",
            "stock",
            "payment settings",
            "delivery templates",
        ],
    }
    write_json(artifact_dir / "summary.json", result)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
