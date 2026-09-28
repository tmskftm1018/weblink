class InvalidRunTransition(ValueError):
    pass


_ALLOWED = {
    "QUEUED": {"RUNNING", "FAILED"},
    "RUNNING": {"SUCCEEDED", "FAILED"},
    "SUCCEEDED": set(),
    "FAILED": set(),
}


def transition_run(current: str, target: str) -> str:
    if target not in _ALLOWED.get(current, set()):
        raise InvalidRunTransition(f"Cannot move run from {current} to {target}")
    return target
