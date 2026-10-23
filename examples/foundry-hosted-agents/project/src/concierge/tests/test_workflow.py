from concierge import workflow
from concierge.fencing import fence


def test_executor_ids_are_stable():
    # Renaming these breaks checkpoint restore for conversations in flight.
    assert (workflow.POLICY_STEP, workflow.BOOKING_STEP) == ("policy", "booking")


def test_main_serves_a_factory():
    import main

    assert main.create_concierge is workflow.create_concierge


def test_fence_escapes_attributes():
    assert fence("policy_excerpt", "x", title='A "quoted" title').startswith('<policy_excerpt title="A &quot;quoted&quot; title">')
