#!/usr/bin/env python3
"""Check Apple Evergreen Walk pickup stock for iPhone Duo 256GB Star White.

Uses Apple's public but undocumented pickup JSON endpoint.
Never places an order. No external Python dependencies.
"""
import argparse
import json
import os
import smtplib
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path

PART = "MK1E4LL/A"
STORE = "R613"
STORE_NAME = "Evergreen Walk"
PRODUCT_TITLE = "iPhone Duo 256GB Star White"
BUY_URL = "https://www.apple.com/shop/buy-iphone/iphone-duo/7.6-inch-display-256gb-star-white-unlocked"
ENDPOINT = "https://www.apple.com/shop/retail/pickup-message"
STATE_FILE = Path.home() / ".duo_stock_watch" / "state.json"


def log(message):
    print(f"[{datetime.now(timezone.utc).isoformat(timespec='seconds')}] {message}", flush=True)


def fetch_stock():
    query = urllib.parse.urlencode({
        "pl": "true",
        "location": "06066",
        "parts.0": PART,
    })
    request = urllib.request.Request(
        ENDPOINT + "?" + query,
        headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15",
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": "https://www.apple.com/shop/buy-iphone/iphone-duo",
        },
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        data = json.load(response)
    return parse_stock(data)


def parse_stock(data):
    if not isinstance(data, dict) or str(data.get("head", {}).get("status")) != "200":
        raise ValueError("Apple did not return status 200")
    stores = data.get("body", {}).get("stores")
    if not isinstance(stores, list):
        raise ValueError("Missing store list; endpoint may have changed")
    matches = [s for s in stores if s.get("storeNumber") == STORE]
    if len(matches) != 1:
        raise ValueError("Target store R613 not found; not treating as out of stock")
    store = matches[0]
    if store.get("storeName") != STORE_NAME:
        raise ValueError("Store name/number do not match")
    item = store.get("partsAvailability", {}).get(PART)
    if not isinstance(item, dict):
        raise ValueError("Target part missing from response")
    title = (item.get("messageTypes", {}).get("regular") or {}).get("storePickupProductTitle", "")
    if title and title.strip().casefold() != PRODUCT_TITLE.casefold():
        raise ValueError("SKU product title mismatch: " + title)
    status = item.get("pickupDisplay")
    quote = item.get("pickupSearchQuote") or ""
    if status == "available" and item.get("storePickEligible") is True:
        return True, quote
    if status == "unavailable":
        return False, quote
    raise ValueError("Unrecognized or ineligible pickup status: " + repr(status))


def send_gmail(title, message):
    sender = os.environ.get("EMAIL_SENDER", "").strip()
    recipient = os.environ.get("EMAIL_TO", "").strip()
    password = os.environ.get("DUO_SMTP_APP_PASSWORD", "").strip()
    if not (sender and recipient and password):
        return False
    mail = EmailMessage()
    mail["From"] = sender
    mail["To"] = recipient
    mail["Subject"] = title
    mail.set_content(message + "\n\nApple: " + BUY_URL)
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=20) as smtp:
        smtp.login(sender, password)
        smtp.send_message(mail)
    return True


def notify(title, message):
    """Deliver only through Gmail. Do not use ntfy."""
    if not send_gmail(title, message):
        raise RuntimeError("Gmail secrets missing: EMAIL_SENDER, EMAIL_TO, DUO_SMTP_APP_PASSWORD")
    log("Gmail notification sent")


def require_gmail_secrets():
    required = ("EMAIL_SENDER", "EMAIL_TO", "DUO_SMTP_APP_PASSWORD")
    missing = [name for name in required if not os.environ.get(name, "").strip()]
    if missing:
        raise RuntimeError("Missing GitHub Actions secrets: " + ", ".join(missing))


def read_state():
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            log("State unreadable; treating this as a first check")
    return {}


def write_state(state):
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    tmp.replace(STATE_FILE)


def check():
    require_gmail_secrets()
    available, quote = fetch_stock()
    state = read_state()
    log("Apple Evergreen Walk pickup: " + ("AVAILABLE" if available else "unavailable") + " / " + quote)
    if not available:
        state["was_available"] = False
    elif not state.get("was_available"):
        message = (
            "Apple Evergreen Walk has iPhone Duo 256GB Star White available for pickup!\n"
            "401 Evergreen Walk, South Windsor, CT 06074\n"
            "No trade-in; connect to any carrier later. Confirm during Apple checkout.\n"
            "Stock may change quickly.\n" + BUY_URL
        )
        notify("🚨 iPhone Duo AVAILABLE — Evergreen Walk", message)
        state["was_available"] = True
    else:
        log("Stock still available; no repeated alert")
    state["last_checked_utc"] = datetime.now(timezone.utc).isoformat()
    write_state(state)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--test-notification", action="store_true")
    args = parser.parse_args()
    if args.test_notification:
        require_gmail_secrets()
        notify("Gmail TEST — iPhone Duo Evergreen Walk",
               "This is a test email sent by your GitHub Actions stock monitor. It does NOT mean the iPhone is in stock.")
    else:
        check()


if __name__ == "__main__":
    main()
