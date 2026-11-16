from datetime import datetime, timedelta, timezone
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from config import get_settings
from database import get_db
import hashlib
import logging
import secrets

from models import User, UserRole, ApiToken, AuthPolicy, SSOConfig

settings = get_settings()
logger = logging.getLogger("redtrack.auth")

# How a session was established. Carried in the JWT so that turning on
# "Enforce SSO" can cut off sessions that came from a password login without
# touching ones that came from the IdP. Tokens minted before this claim
# existed have no auth_method and are treated as password sessions; SSO users
# holding one just sign in through SSO again.
AUTH_METHOD_PASSWORD = "password"
AUTH_METHOD_SSO = "sso"
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer_scheme = HTTPBearer(auto_error=False)

TOKEN_PREFIX = "rt_"


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: Optional[str]) -> bool:
    # SSO-provisioned accounts have no local password (hashed_password is NULL).
    # Without this guard passlib raises and the caller 500s instead of returning
    # a clean 401.
    if not hashed:
        return False
    return pwd_context.verify(plain, hashed)


def generate_api_token() -> tuple[str, str, str]:
    """Returns (raw_token, token_hash, prefix). The raw token is shown once."""
    raw = TOKEN_PREFIX + secrets.token_urlsafe(32)
    return raw, hash_token(raw), raw[:12]


def hash_token(raw: str) -> str:
    # sha256, not bcrypt: lookups must be a deterministic indexed match, and
    # these are high-entropy random tokens rather than user-chosen passwords.
    return hashlib.sha256(raw.encode()).hexdigest()


def create_access_token(user_id: str, auth_method: str = AUTH_METHOD_PASSWORD) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    return jwt.encode(
        {"sub": user_id, "exp": expire, "type": "access", "auth_method": auth_method},
        settings.secret_key,
        algorithm=settings.algorithm,
    )


def create_refresh_token(user_id: str, auth_method: str = AUTH_METHOD_PASSWORD) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days)
    return jwt.encode(
        {"sub": user_id, "exp": expire, "type": "refresh", "auth_method": auth_method},
        settings.secret_key,
        algorithm=settings.algorithm,
    )


def decode_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        return payload
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

# ─── SSO enforcement ──────────────────────────────────────────────────────────

async def sso_enforced(db: AsyncSession) -> bool:
    """
    True when an admin has turned on "Enforce SSO" AND at least one SSO
    provider is actually enabled. The second condition means disabling every
    provider can never strand a deployment with no way to sign in at all.
    """
    policy = await db.get(AuthPolicy, 1)
    if not policy or not policy.enforce_sso:
        return False
    result = await db.execute(select(SSOConfig.id).where(SSOConfig.enabled.is_(True)).limit(1))
    return result.first() is not None


async def local_login_blocked(db: AsyncSession) -> bool:
    """SSO is enforced and the ALLOW_LOCAL_LOGIN break-glass is not set."""
    if settings.allow_local_login:
        return False
    return await sso_enforced(db)


LOCAL_LOGIN_DISABLED = "Local sign-in is disabled on this server. Sign in with SSO."


async def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    # Try API key first (X-API-Key header)
    api_key = request.headers.get("X-API-Key")
    if api_key:
        # New path: named tokens. Match on hash, ignore revoked ones.
        result = await db.execute(
            select(ApiToken).where(
                ApiToken.token_hash == hash_token(api_key),
                ApiToken.revoked_at.is_(None),
            )
        )
        token = result.scalar_one_or_none()
        if token:
            user_result = await db.execute(select(User).where(User.id == token.user_id))
            user = user_result.scalar_one_or_none()
            if user and user.is_active:
                await _check_api_key_owner(db, user)
                request.state.auth_method = "api_token"
                # Throttled so we're not writing on every single request.
                now = datetime.now(timezone.utc)
                if token.last_used_at is None or (now - token.last_used_at).total_seconds() > 300:
                    token.last_used_at = now
                return user
            raise HTTPException(status_code=401, detail="Invalid API key")

        # Legacy path: the old single User.api_key. Kept so existing RedNote /
        # redtrack-cli installs keep working until they're migrated over.
        result = await db.execute(select(User).where(User.api_key == api_key))
        user = result.scalar_one_or_none()
        if user and user.is_active:
            await _check_api_key_owner(db, user)
            request.state.auth_method = "api_token"
            return user
        raise HTTPException(status_code=401, detail="Invalid API key")
    
    # Fall back to Bearer token
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = decode_token(credentials.credentials)
    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Invalid token type")
    auth_method = payload.get("auth_method", AUTH_METHOD_PASSWORD)
    # Enforcing SSO has to end password sessions that already exist, not just
    # stop new ones; otherwise anyone signed in locally keeps access until
    # their refresh token runs out.
    if auth_method != AUTH_METHOD_SSO and await local_login_blocked(db):
        raise HTTPException(status_code=401, detail=LOCAL_LOGIN_DISABLED)
    request.state.auth_method = auth_method
    user_id = payload.get("sub")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    return user


async def _check_api_key_owner(db: AsyncSession, user: User) -> None:
    """
    API tokens stay valid under SSO enforcement for accounts linked to the IdP
    (the CLI, RedNote and the Burp extension need them; they can't do a
    browser SSO round-trip). Tokens owned by local-only accounts are refused,
    or they would be a way around enforcement.
    """
    if not user.sso_provider and await local_login_blocked(db):
        raise HTTPException(
            status_code=401,
            detail="API tokens for local accounts are disabled while SSO is enforced",
        )


def require_roles(*roles: UserRole):
    async def checker(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Requires role: {', '.join(r.value for r in roles)}"
            )
        return current_user
    return checker


require_admin = require_roles(UserRole.admin)
require_lead_or_admin = require_roles(UserRole.admin, UserRole.lead)
require_tester_or_above = require_roles(UserRole.admin, UserRole.lead, UserRole.tester)
