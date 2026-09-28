class InvalidJobTransition(ValueError):
    pass


_ALLOWED = {
    "QUEUED": {"RUNNING", "CANCELLED"},
    "RUNNING": {"QUEUED", "SUCCEEDED", "FAILED", "CANCELLED"},
    "SUCCEEDED": set(),
    "FAILED": set(),
    "CANCELLED": set(),
}


def transition_job(current: str, target: str) -> str:
    if target not in _ALLOWED.get(current, set()):
        raise InvalidJobTransition(f"Cannot move job from {current} to {target}")
    return target
