"""Render one Unconcealed research notice for a consenting Alethical account.

The mailer uses the published piece's title and dates, and links directly to its
public page. It does not add a summary, tracking pixel, or redirect. Rendering
does not contact Resend or save any subscription choice.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from email.utils import parseaddr
from html import escape
from urllib.parse import quote, urlsplit

PUBLIC_ORIGIN = "https://www.alethical.com"
API_ORIGIN = "https://api.alethical.com"
FONT_STACK = (
    "'Libre Franklin',-apple-system,BlinkMacSystemFont,'Segoe UI',"
    "Helvetica,Arial,sans-serif"
)


@dataclass(frozen=True)
class PublishedResearch:
    slug: str
    title: str
    published_on: date
    records_through: date
    public_url: str

    def validate(self) -> None:
        if (
            not self.slug
            or not self.slug.isascii()
            or not all(
                char.islower() or char.isdigit() or char == "-" for char in self.slug
            )
        ):
            raise ValueError("The research slug is invalid")
        if not self.title.strip() or any(char in self.title for char in "\r\n"):
            raise ValueError("The research title is invalid")
        if self.public_url != f"{PUBLIC_ORIGIN}/read/research/{self.slug}":
            raise ValueError("Research must link directly to its public Alethical page")
        if self.records_through > self.published_on:
            raise ValueError("The records-through date cannot follow publication")


@dataclass(frozen=True)
class ResearchEmail:
    subject: str
    html: str
    text: str
    headers: dict[str, str]


def _date_label(value: date) -> str:
    return f"{value.strftime('%B')} {value.day}, {value.year}"


def _require_postal_address(value: str) -> str:
    normalized = value.strip()
    if (
        len(normalized) < 16
        or any(char in normalized for char in "\r\n<>")
        or normalized.casefold() in {"missing", "tbd", "todo", "postal address"}
    ):
        raise ValueError("A verified sender postal address is required")
    return normalized


def validate_sender(value: str) -> str:
    sender = value.strip()
    name, address = parseaddr(sender)
    if not name or not address or sender != f"{name} <{address}>":
        raise ValueError("Set a sender name and address in Name <address> form")
    if not address.lower().endswith("@alethical.com"):
        raise ValueError("The sender address must be on alethical.com")
    if any(char in sender for char in "\r\n"):
        raise ValueError("The sender address is invalid")
    return sender


def _token_links(raw_token: str) -> tuple[str, str]:
    if (
        not raw_token
        or not raw_token.isascii()
        or not all(char.isalnum() or char in "-_" for char in raw_token)
    ):
        raise ValueError("The unsubscribe token is invalid")
    token = quote(raw_token, safe="")
    return (
        f"{PUBLIC_ORIGIN}/unsubscribe#unsubscribe={token}",
        f"{API_ORIGIN}/api/v1/email-subscriptions/one-click/{token}",
    )


def render_research_email(
    piece: PublishedResearch,
    *,
    unsubscribe_token: str,
    postal_address: str,
) -> ResearchEmail:
    """Return HTML, matching text and unsubscribe headers for 1 recipient."""
    piece.validate()
    postal = _require_postal_address(postal_address)
    unsubscribe_url, one_click_url = _token_links(unsubscribe_token)
    title = escape(piece.title, quote=True)
    public_url = escape(piece.public_url, quote=True)
    unsubscribe_html = escape(unsubscribe_url, quote=True)
    postal_html = escape(postal, quote=True)
    published = _date_label(piece.published_on)
    records_through = _date_label(piece.records_through)
    published_html = escape(published)
    records_html = escape(records_through)

    # Nested tables, explicit dimensions and inline styles are intentional here:
    # they keep the email readable in mail apps with limited CSS support.
    html = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style type="text/css">@media screen and (max-width:480px){{.mail-pad{{padding-left:22px!important;padding-right:22px!important}}.mail-head{{padding-top:26px!important}}.mail-brand{{font-size:22px!important}}.mail-divider{{margin-top:18px!important}}.mail-body{{padding-top:22px!important;padding-bottom:32px!important}}.mail-title{{font-size:27px!important;line-height:1.18!important;margin-top:8px!important}}.mail-dates{{margin-top:14px!important}}.mail-action-table,.mail-action-cell{{width:100%!important}}.mail-action{{display:block!important;width:100%!important;box-sizing:border-box!important}}.mail-footer{{padding-top:22px!important;padding-bottom:26px!important}}.mail-link{{display:block!important;min-height:44px!important;line-height:44px!important}}}}@media (hover:hover) and (pointer:fine){{.mail-action:hover{{background:#28bf71!important}}}}</style>
</head><body style="margin:0;padding:0;background:#eef0ef;color:#11150f;font-family:{FONT_STACK}">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background:#eef0ef"><tr><td align="center" style="padding:24px 0">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="border-collapse:collapse;width:100%;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden">
<tr><td class="mail-pad mail-head" style="padding:34px 44px 0;font-family:{FONT_STACK}"><div class="mail-brand" style="font-size:24px;font-weight:800;line-height:1.2;color:#11150f">Unconcealed</div><div class="mail-divider" style="margin-top:22px;height:1px;background:#dfe3df"></div></td></tr>
<tr><td class="mail-pad mail-body" style="padding:28px 44px 40px;font-family:{FONT_STACK}">
<p style="margin:0;font-size:16px;line-height:1.5;font-weight:600;color:#4b524b">New research from Alethical</p>
<h1 class="mail-title" style="margin:10px 0 0;font-size:32px;line-height:1.15;font-weight:800;color:#11150f;overflow-wrap:anywhere">{title}</h1>
<div class="mail-dates" style="margin-top:18px;font-size:16px;line-height:1.5;color:#4b524b;font-variant-numeric:tabular-nums"><div>Published <strong style="color:#11150f">{published_html}</strong></div><div style="margin-top:4px">Records through <strong style="color:#11150f">{records_html}</strong></div></div>
<table class="mail-action-table" role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;margin-top:28px"><tr><td class="mail-action-cell" bgcolor="#2ed47e" style="border-radius:12px;background:#2ed47e;text-align:center"><a class="mail-action" href="{public_url}" style="display:inline-block;min-height:52px;line-height:52px;padding:0 30px;border-radius:12px;background:#2ed47e;color:#06231a;text-decoration:none;font-size:17px;font-weight:700;font-family:{FONT_STACK}">Read the research</a></td></tr></table>
</td></tr>
<tr><td class="mail-pad mail-footer" style="padding:28px 44px 32px;background:#f5f6f7;border-top:1px solid #e5e8e5;font-family:{FONT_STACK}">
<p style="margin:0;font-size:14.5px;line-height:1.55;color:#4b524b">You’re receiving this because you subscribed to Unconcealed</p>
<p style="margin:12px 0 0;font-size:14.5px;line-height:1.5;font-weight:700"><a class="mail-link" href="{unsubscribe_html}" style="color:#0f7a45;margin-right:22px">Unsubscribe</a><a class="mail-link" href="{PUBLIC_ORIGIN}/email-preferences" style="color:#0f7a45;margin-right:22px">Email preferences</a><a class="mail-link" href="mailto:ask@alethical.com" style="color:#0f7a45">Contact us</a></p>
<p style="margin:12px 0 0;font-size:13px;line-height:1.5;color:#4b524b;overflow-wrap:anywhere">{postal_html}</p>
</td></tr></table></td></tr></table></body></html>"""
    text = "\n".join(
        [
            "Unconcealed",
            "",
            "New research from Alethical",
            piece.title,
            f"Published {published}",
            f"Records through {records_through}",
            "",
            "Read the research:",
            piece.public_url,
            "",
            "You’re receiving this because you subscribed to Unconcealed",
            f"Unsubscribe: {unsubscribe_url}",
            f"Email preferences: {PUBLIC_ORIGIN}/email-preferences",
            "Contact us: ask@alethical.com",
            postal,
        ]
    )
    return ResearchEmail(
        subject=f"Unconcealed: {piece.title}",
        html=html,
        text=text,
        headers={
            "List-Unsubscribe": f"<{one_click_url}>",
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
    )


def sender_domain(sender: str) -> str:
    """The exact domain Resend must report as verified and tracking-free."""
    validate_sender(sender)
    _, address = parseaddr(sender)
    return address.rsplit("@", 1)[1].lower()


def is_direct_public_research_url(url: str) -> bool:
    parts = urlsplit(url)
    return (
        parts.scheme == "https"
        and parts.netloc == "www.alethical.com"
        and parts.path.startswith("/read/research/")
        and not parts.query
        and not parts.fragment
    )
