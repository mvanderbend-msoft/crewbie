import pytest

from concierge.config import load_settings


def test_settings_come_from_the_environment(settings_env):
    settings = load_settings()
    assert settings.model == "test-model"
    assert settings.booking_scope.endswith("/.default")


def test_local_model_fallback(settings_env, monkeypatch):
    monkeypatch.delenv("AZURE_AI_MODEL_DEPLOYMENT_NAME")
    monkeypatch.setenv("FOUNDRY_MODEL_NAME", "local-model")
    assert load_settings().model == "local-model"


def test_missing_model_fails_fast(settings_env, monkeypatch):
    monkeypatch.delenv("AZURE_AI_MODEL_DEPLOYMENT_NAME")
    monkeypatch.delenv("FOUNDRY_MODEL_NAME", raising=False)
    with pytest.raises(RuntimeError):
        load_settings()
