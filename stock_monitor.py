#!/usr/bin/env python3
"""Check Evergreen Walk and Westfarms pickup stock for iPhone Duo 256GB Star White.

Uses Apple's public but undocumented pickup JSON endpoint.
Never places an order. No external Python dependencies.
"""
import argparse
import json
import os
import smtplib
import ssl
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path

PART = "MK1E4LL/A"
STORES = [
    {"number": "R613", "name": "Evergreen Walk", "zip": "06066", "address": "401 Evergreen Walk, South Windsor, CT 06074"},
    {"number": "R025", "name": "Westfarms", "zip": "06032", "address": "500 Westfarms Mall, Farmington, CT 06032"},
]
PRODUCT_TITLE = "iPhone Duo 256GB Star White"
BUY_URL = "https://www.apple.com/shop/buy-iphone/iphone-duo/7.6-inch-display-256gb-star-white-unlocked"
ENDPOINT = "https://www.apple.com/shop/retail/pickup-message"
STATE_FILE = Path.home() / ".duo_stock_watch" / "state.json"


def log(message):
    print(f"[{datetime.now(timezone.utc).isoformat(timespec='seconds')}] {message}", flush=True)


def fetch_stock(target):
    query = urllib.parse.urlencode({
        "pl": "true",
        "location": target["zip"],
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
    return parse_stock(data, target)


def parse_stock(data, target):
    if not isinstance(data, dict) or str(data.get("head", {}).get("status")) != "200":
        raise ValueError("Apple did not return status 200")
    stores = data.get("body", {}).get("stores")
    if not isinstance(stores, list):
        raise ValueError("Missing store list; endpoint may have changed")
    matches = [s for s in stores if s.get("storeNumber") == target["number"]]
    if len(matches) != 1:
        raise ValueError(f'Target store {target["number"]} not found; not treating as out of stock')
    store = matches[0]
    if store.get("storeName") != target["name"]:
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
    # Google displays app passwords grouped with spaces; SMTP needs the raw 16 characters.
    password = "".join(os.environ.get("DUO_SMTP_APP_PASSWORD", "").split())
    if not (sender and recipient and password):
        return False
    mail = EmailMessage()
    mail["From"] = sender
    mail["To"] = recipient
    mail["Subject"] = title
    mail.set_content(message + "\n\nApple: " + BUY_URL)

    # First try STARTTLS/587; try SSL/465 only for transport disconnects.
    context = ssl.create_default_context()
    try:
        with smtplib.SMTP("smtp.gmail.com", 587, timeout=25) as smtp:
            smtp.ehlo()
            smtp.starttls(context=context)
            smtp.ehlo()
            smtp.login(sender, password)
            smtp.send_message(mail)
    except (smtplib.SMTPServerDisconnected, TimeoutError, OSError) as first_error:
        log("SMTP 587 transport error; retrying SSL port 465")
        try:
            with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=25, context=context) as smtp:
                smtp.login(sender, password)
                smtp.send_message(mail)
        except (smtplib.SMTPServerDisconnected, TimeoutError, OSError) as second_error:
            raise RuntimeError(
                "Gmail SMTP connection failed on both ports 587 and 465 "
                f"({type(first_error).__name__}, {type(second_error).__name__}). "
                "Google may be closing connections from GitHub runners."
            ) from second_error
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
    state = read_state()
    failures = []
    for target in STORES:
        name = target["name"]
        key = target["number"]
        try:
            available, quote = fetch_stock(target)
            log("Apple " + name + " pickup: " + ("AVAILABLE" if available else "unavailable") + " / " + quote)
            previous = state.get(key, {}).get("was_available")
            if previous is None and key == "R613":
                previous = state.get("was_available", False)
            if available and not previous:
                message = (
                    f'Apple {name} has iPhone Duo 256GB Star White available for pickup!\\n'
                    + target["address"] + "\\n"
                    + "No trade-in; connect to any carrier later. Confirm during Apple checkout.\\n"
                    + "Stock may change quickly.\\n" + BUY_URL
                )
                notify(f"🚨 iPhone Duo AVAILABLE — {name}", message)
            elif available:
                log(name + " still available; no repeated alert")
            state[key] = {
                "was_available": available,
                "last_checked_utc": datetime.now(timezone.utc).isoformat()
            }
            write_state(state)
        except Exception as exc:
            failures.append(f"{name}: {type(exc).__name__}: {exc}")
            log("ERROR " + failures[-1] + " (not treating as out of stock)")
    if failures:
        raise RuntimeError("; ".join(failures))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--test-notification", action="store_true")
    args = parser.parse_args()
    if args.test_notification:
        require_gmail_secrets()
        notify("Gmail TEST — iPhone Duo (Evergreen Walk + Westfarms)",
               "This is a test email sent by your GitHub Actions stock monitor. It does NOT mean the iPhone is in stock.")
    else:
        check()


if __name__ == "__main__":
    main()
