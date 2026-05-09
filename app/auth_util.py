"""邮箱验证码登录：OTP 存储、邮件发送、权限判断。"""
from __future__ import annotations

import logging
import os
import random
import smtplib
import string
import threading
import time
from email.message import EmailMessage

logger = logging.getLogger(__name__)

SUPER_ADMIN_EMAIL = "3162853966@qq.com"

# 访客登录使用的固定账号（无验证码）；上传与对比记录的 owner_email 均为该值
GUEST_ACCOUNT_EMAIL = "guest"

# SMTP：未配置时在日志中打印验证码（便于本地开发）
SMTP_HOST = os.environ.get("SMTP_HOST", "").strip()
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "").strip()
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "").strip()
SMTP_FROM = os.environ.get("SMTP_FROM", SMTP_USER).strip()
OTP_TTL_SEC = int(os.environ.get("OTP_TTL_SEC", "600"))
OTP_COOLDOWN_SEC = int(os.environ.get("OTP_COOLDOWN_SEC", "60"))

_lock = threading.Lock()
# email_lower -> (code, expire_monotonic, last_send_monotonic)
_otp: dict[str, tuple[str, float, float]] = {}


def normalize_email(email: str) -> str:
    return email.strip().lower()


def is_super_admin(email: str) -> bool:
    return normalize_email(email) == normalize_email(SUPER_ADMIN_EMAIL)


def can_access_owner_field(owner_email: str | None, user_email: str, super_admin: bool) -> bool:
    if super_admin:
        return True
    if owner_email is None:
        return False
    return normalize_email(owner_email) == normalize_email(user_email)


def _otp_key(email: str) -> str:
    return normalize_email(email)


def _generate_code() -> str:
    return "".join(random.choices(string.digits, k=6))


def store_and_send_otp(email: str) -> tuple[str, str | None]:
    """
    生成验证码并尝试发送邮件。
    返回 (用于响应的提示文案, 开发模式下可在 JSON 中带回的 code — 仅无 SMTP 时非 None)。
    """
    key = _otp_key(email)
    now = time.monotonic()
    with _lock:
        prev = _otp.get(key)
        if prev is not None:
            _, _, last_send = prev
            if now - last_send < OTP_COOLDOWN_SEC:
                wait = int(OTP_COOLDOWN_SEC - (now - last_send)) + 1
                raise ValueError(f"发送过于频繁，请 {wait} 秒后再试")
        code = _generate_code()
        expire_at = now + OTP_TTL_SEC
        _otp[key] = (code, expire_at, now)

    dev_code: str | None = None
    if SMTP_HOST and SMTP_USER and SMTP_PASSWORD:
        try:
            _send_smtp_email(key, code)
            msg = "验证码已发送到邮箱，请查收（含垃圾箱）"
        except Exception as e:
            logger.exception("发送邮件失败")
            with _lock:
                _otp.pop(key, None)
            raise ValueError(f"邮件发送失败：{e}") from e
    else:
        logger.warning("SMTP 未配置，验证码（仅开发）: %s -> %s", key, code)
        dev_code = code
        msg = "开发模式：未配置 SMTP，验证码已记录在服务器日志"

    return msg, dev_code


def verify_otp(email: str, code: str) -> bool:
    key = _otp_key(email)
    raw = (code or "").strip()
    if not raw:
        return False
    now = time.monotonic()
    with _lock:
        entry = _otp.get(key)
        if not entry:
            return False
        stored, expire_at, _ = entry
        if now > expire_at:
            _otp.pop(key, None)
            return False
        if stored != raw:
            return False
        _otp.pop(key, None)
        return True


def _send_smtp_email(to_addr: str, code: str) -> None:
    body = f"您的登录验证码为：{code}\n\n{OTP_TTL_SEC // 60} 分钟内有效。如非本人操作请忽略。"
    msg = EmailMessage()
    msg["Subject"] = "登录验证码"
    msg["From"] = SMTP_FROM or SMTP_USER
    msg["To"] = to_addr
    msg.set_content(body)

    if SMTP_PORT == 465:
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=30) as smtp:
            smtp.login(SMTP_USER, SMTP_PASSWORD)
            smtp.send_message(msg)
    else:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30) as smtp:
            smtp.ehlo()
            smtp.starttls()
            smtp.ehlo()
            smtp.login(SMTP_USER, SMTP_PASSWORD)
            smtp.send_message(msg)
