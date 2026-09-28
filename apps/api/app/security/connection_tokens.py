from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings


class ConnectionEncryptionUnavailable(Exception):
    pass


def _cipher() -> Fernet:
    key = settings.connection_encryption_key
    if not key:
        raise ConnectionEncryptionUnavailable
    try:
        return Fernet(key.encode("ascii"))
    except (ValueError, UnicodeEncodeError) as exc:
        raise ConnectionEncryptionUnavailable from exc


def encryption_key_is_valid() -> bool:
    try:
        _cipher()
    except ConnectionEncryptionUnavailable:
        return False
    return True


def encrypt_token(token: str) -> str:
    return _cipher().encrypt(token.encode("utf-8")).decode("ascii")


def decrypt_token(token: str) -> str:
    try:
        return _cipher().decrypt(token.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError, UnicodeEncodeError) as exc:
        raise ConnectionEncryptionUnavailable from exc
