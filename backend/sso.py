"""
SSO — SAML2 and OIDC.

Both providers are configured entirely through the admin UI (see the
SSOConfig model / /admin/sso routes in main.py) — no env vars or config
files to hand-edit to stand up SSO for a new deployment.

Flow for both providers ends the same way: after the IdP redirects back to
us and we've validated the assertion/token, we don't hand a JWT back to the
browser via a redirect URL (which would land in browser history / server
logs). Instead we mint a short-lived, single-use exchange code, redirect the
browser to the frontend with just that code, and the frontend immediately
POSTs it to /auth/sso/exchange to get real access/refresh tokens.
"""
import secrets
from typing import Optional
from urllib.parse import urlencode

import httpx
import redis.asyncio as aioredis
from fastapi import Request, HTTPException
from jose import jwt as jose_jwt
from onelogin.saml2.auth import OneLogin_Saml2_Auth
from onelogin.saml2.idp_metadata_parser import OneLogin_Saml2_IdPMetadataParser
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from models import SSOConfig

settings = get_settings()
_redis = aioredis.from_url(settings.redis_url, decode_responses=True)


# ─── One-time exchange codes ───────────────────────────────────────────────
# Used for both SAML and OIDC once the IdP round-trip is done.

async def store_exchange_code(user_id: str) -> str:
    code = secrets.token_urlsafe(32)
    await _redis.setex(f"sso_exchange:{code}", 60, user_id)
    return code


async def consume_exchange_code(code: str) -> Optional[str]:
    key = f"sso_exchange:{code}"
    user_id = await _redis.get(key)
    if user_id:
        await _redis.delete(key)
    return user_id


# ─── OIDC state/nonce storage ──────────────────────────────────────────────
# Prevents CSRF (state) and token replay (nonce) across the redirect to the IdP.

async def store_oidc_transaction(state: str, nonce: str):
    await _redis.setex(f"oidc_txn:{state}", 300, nonce)


async def consume_oidc_transaction(state: str) -> Optional[str]:
    key = f"oidc_txn:{state}"
    nonce = await _redis.get(key)
    if nonce:
        await _redis.delete(key)
    return nonce


# ─── Config lookups ─────────────────────────────────────────────────────────

async def get_sso_config(db: AsyncSession, provider: str) -> Optional[SSOConfig]:
    result = await db.execute(select(SSOConfig).where(SSOConfig.provider == provider))
    return result.scalar_one_or_none()


# ─── SAML2 ──────────────────────────────────────────────────────────────────

def _saml_settings(cfg: SSOConfig) -> dict:
    base = settings.frontend_url.rstrip("/")
    return {
        "strict": True,
        "debug": settings.app_env == "development",
        "sp": {
            "entityId": f"{base}/api/auth/sso/saml/metadata",
            "assertionConsumerService": {
                "url": f"{base}/api/auth/sso/saml/acs",
                "binding": "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST",
            },
            "singleLogoutService": {
                "url": f"{base}/api/auth/sso/saml/sls",
                "binding": "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect",
            },
            "NameIDFormat": "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
        },
        "idp": {
            "entityId": cfg.saml_idp_entity_id,
            "singleSignOnService": {
                "url": cfg.saml_idp_sso_url,
                "binding": "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect",
            },
            "x509cert": cfg.saml_idp_x509_cert or "",
        },
    }


async def _saml_request_data(request: Request) -> dict:
    form = {}
    if request.method == "POST":
        form_data = await request.form()
        form = dict(form_data)
    # nginx terminates TLS and proxies to us over plain HTTP, so request.url.scheme
    # would report "http" unless we honor X-Forwarded-Proto (which the nginx config
    # does set on the /api/ location).
    proto = request.headers.get("x-forwarded-proto", request.url.scheme)
    is_https = proto == "https"
    return {
        "https": "on" if is_https else "off",
        "http_host": request.url.hostname,
        "server_port": 443 if is_https else 80,
        "script_name": request.url.path,
        "get_data": dict(request.query_params),
        "post_data": form,
    }


async def build_saml_auth(request: Request, cfg: SSOConfig) -> OneLogin_Saml2_Auth:
    req_data = await _saml_request_data(request)
    return OneLogin_Saml2_Auth(req_data, _saml_settings(cfg))


def fetch_saml_idp_metadata(metadata_url: str) -> dict:
    """
    Auto-populate IdP entity ID / SSO URL / cert from a metadata URL, so the
    admin only has to paste one link instead of copying three separate
    fields out of their IdP's admin console.
    """
    idp_data = OneLogin_Saml2_IdPMetadataParser.parse_remote(metadata_url)
    idp = idp_data.get("idp", {})
    return {
        "entity_id": idp.get("entityId"),
        "sso_url": (idp.get("singleSignOnService") or {}).get("url"),
        "x509_cert": idp.get("x509cert"),
    }


# ─── OIDC ───────────────────────────────────────────────────────────────────

async def oidc_discovery(issuer: str) -> dict:
    issuer = issuer.rstrip("/")
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{issuer}/.well-known/openid-configuration")
        resp.raise_for_status()
        return resp.json()


def oidc_redirect_uri() -> str:
    return f"{settings.frontend_url.rstrip('/')}/api/auth/sso/oidc/callback"


async def build_oidc_auth_url(cfg: SSOConfig) -> str:
    disco = await oidc_discovery(cfg.oidc_issuer)
    state = secrets.token_urlsafe(24)
    nonce = secrets.token_urlsafe(24)
    await store_oidc_transaction(state, nonce)
    params = {
        "response_type": "code",
        "client_id": cfg.oidc_client_id,
        "redirect_uri": oidc_redirect_uri(),
        "scope": "openid email profile",
        "state": state,
        "nonce": nonce,
    }
    return f"{disco['authorization_endpoint']}?{urlencode(params)}"


async def exchange_oidc_code(cfg: SSOConfig, code: str) -> dict:
    disco = await oidc_discovery(cfg.oidc_issuer)
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            disco["token_endpoint"],
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": oidc_redirect_uri(),
                "client_id": cfg.oidc_client_id,
                "client_secret": cfg.oidc_client_secret,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        resp.raise_for_status()
        return resp.json()


async def verify_oidc_id_token(cfg: SSOConfig, id_token: str, expected_nonce: str) -> dict:
    disco = await oidc_discovery(cfg.oidc_issuer)
    async with httpx.AsyncClient(timeout=10) as client:
        jwks_resp = await client.get(disco["jwks_uri"])
        jwks_resp.raise_for_status()
        jwks = jwks_resp.json()

    unverified_header = jose_jwt.get_unverified_header(id_token)
    key = next((k for k in jwks["keys"] if k["kid"] == unverified_header["kid"]), None)
    if not key:
        raise HTTPException(400, "OIDC: no matching JWKS key for ID token")

    claims = jose_jwt.decode(
        id_token,
        key,
        algorithms=[unverified_header["alg"]],
        audience=cfg.oidc_client_id,
        issuer=disco["issuer"],
    )
    if claims.get("nonce") != expected_nonce:
        raise HTTPException(400, "OIDC: nonce mismatch — possible replay attempt")
    return claims
